import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { useAuth } from '@/auth/session';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { BigTile, BottomSheet } from '@/components/big-ui';
import { RequestToPayDialog, type PaidRequest } from '@/components/request-to-pay';
import { PickTile } from '@/components/sell/pick-tile';
import { SaleDone } from '@/components/sell/sale-done';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Icon,
  LoadingList,
  Row,
  Screen,
  SearchField,
} from '@/components/ui';
import {
  collectSaleWarnings,
  hasSaleWarnings,
  maxSellable,
  priceSale,
  todayLocal,
  toNgwee,
  variantLabel,
  type LineInput,
  type PaymentInput,
  type Provider,
} from '@/core';
import { useProducts, useShop } from '@/db/hooks';
import {
  addPaymentMessage,
  findVariantByBarcode,
  InsufficientStockError,
  reconcileDay,
  recordSale,
  type StockShortfall,
} from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

type Method = 'cash' | 'mobile_money' | 'split';
/** How the last attempt was paid, so an owner-approved retry pays the same way. */
type Via = { method: Method; paid?: PaidRequest; manual?: { provider: Provider; reference: string } };

/**
 * Selling, one question at a time: what is the customer buying (tap the
 * pictures), how did they pay (two big buttons in a sheet), done (a big tick).
 * The total is always on the bottom button. Pricing, warnings, stock checks
 * and payment filing are unchanged; only the way the cashier gets there is.
 */
export default function NewSaleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { user, can } = useAuth();
  const guard = usePermissionGuard();
  const { data: products, initialLoading, error: loadError, reload: reloadProducts } = useProducts();
  const { data: shop } = useShop();
  const seesMoney = can('money.insights');
  const canApproveOverride = can('stock.override');

  const [quantityByVariant, setQuantityByVariant] = useState<Record<string, number>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [provider, setProvider] = useState<Provider>('MTN');
  const [reference, setReference] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<StockShortfall[] | null>(null);
  const [stockNote, setStockNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState<PaidRequest | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // The mobile-money dialog waits until the sheet has finished sliding away,
  // so two pop-ups are never on screen together.
  const [dialogAfterSheet, setDialogAfterSheet] = useState(false);
  const [lastVia, setLastVia] = useState<Via>({ method: 'cash' });
  const [done, setDone] = useState<{ saleId: string; total: number; method: Method } | null>(null);

  const index = useMemo(() => {
    const map = new Map<
      string,
      {
        label: string;
        sellPrice: number;
        buyPrice: number;
        onHand: number;
        discount?: LineInput['productDiscount'];
        saleWarning?: string;
        expiryDate?: string;
      }
    >();
    for (const product of products) {
      for (const variant of product.variants) {
        map.set(variant.id, {
          label: variantLabel(product.name, variant),
          sellPrice: variant.sellPrice,
          buyPrice: variant.buyPrice,
          onHand: variant.quantity,
          discount: product.discount,
          saleWarning: product.saleWarning,
          expiryDate: variant.expiryDate,
        });
      }
    }
    return map;
  }, [products]);

  const needle = query.trim().toLowerCase();
  // Products already in the basket stay visible while searching, so their
  // counts do not vanish mid-sale.
  const shownProducts = needle
    ? products.filter(
        (product) =>
          product.variants.some((variant) => (quantityByVariant[variant.id] ?? 0) > 0) ||
          [
            product.name,
            product.category ?? '',
            ...product.variants.map((variant) => variant.barcode ?? ''),
            // Variant values too, so "crate" or "500 mg" finds the right line.
            ...product.variants.flatMap((variant) => variant.attributes.map((attribute) => attribute.value)),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle)
      )
    : products;

  const lines = useMemo<LineInput[]>(() => {
    // A variant that vanished on reload is dropped from the basket, not thrown on.
    return Object.entries(quantityByVariant)
      .filter(([variantId, quantity]) => quantity > 0 && index.has(variantId))
      .map(([variantId, quantity]) => {
        const entry = index.get(variantId)!;
        return {
          variantId,
          quantity,
          buyPrice: entry.buyPrice,
          sellPrice: entry.sellPrice,
          productDiscount: entry.discount,
        };
      });
  }, [quantityByVariant, index]);

  const priced = useMemo(() => priceSale(lines), [lines]);

  const cashAmount = Math.max(0, toNgwee(Number.parseFloat(cashPart) || 0));
  const mobileAmount = method === 'mobile_money' ? priced.total : Math.max(0, priced.total - cashAmount);
  // An approved request only counts while the basket still asks for exactly
  // that amount from that provider; otherwise the cashier must ask again.
  const paidValid = paid && method !== 'cash' && paid.amount === mobileAmount && paid.provider === provider ? paid : null;
  const saleReference = paidValid ? paidValid.reference : reference;

  /** The payments for a method, built at the moment of saving (the method may have just been picked). */
  const buildPayments = (forMethod: Method, ref: string, network: Provider): PaymentInput[] => {
    if (priced.total === 0) return [];
    if (forMethod === 'cash') return [{ method: 'cash', amount: priced.total }];
    if (forMethod === 'mobile_money') {
      return [{ method: 'mobile_money', provider: network, amount: priced.total, reference: ref }];
    }
    // Split with nothing left for mobile money is just a cash sale.
    if (cashAmount >= priced.total) return [{ method: 'cash', amount: priced.total }];
    return [
      { method: 'cash', amount: cashAmount },
      { method: 'mobile_money', provider: network, amount: priced.total - cashAmount, reference: ref },
    ];
  };

  // Any basket change voids an override shown for the old basket.
  const setQuantity = (variantId: string, next: number) => {
    setShortfalls(null);
    const entry = index.get(variantId);
    // Staff (and an owner who has staff) cannot sell past what is on hand, so
    // the basket stops there and says why. Someone who can approve an override
    // may go over; they are warned and asked to confirm at the end.
    const limit = maxSellable(entry?.onHand ?? 0, canApproveOverride);
    setStockNote(
      next > limit && entry ? t('sale.new.onlyLeft', { count: entry.onHand, item: entry.label }) : null
    );
    setQuantityByVariant((current) => ({ ...current, [variantId]: Math.min(limit, Math.max(0, next)) }));
  };

  /** A scan adds one unit to the basket; the basket itself never leaves this screen. */
  async function handleScanned(code: string) {
    setScannerOpen(false);
    try {
      const match = await findVariantByBarcode(db, code);
      if (!match) {
        setScanMessage(t('sale.new.scanNotFound', { code }));
        return;
      }
      const entry = index.get(match.variantId);
      if (!entry) {
        setScanMessage(t('sale.new.scanNotFound', { code }));
        return;
      }
      setShortfalls(null);
      setQuantityByVariant((current) => ({
        ...current,
        [match.variantId]: Math.min(99, (current[match.variantId] ?? 0) + 1),
      }));
      setScanMessage(t('sale.new.scanAdded', { label: entry.label }));
    } catch (cause) {
      setScanMessage(cause instanceof Error ? cause.message : 'Could not read that barcode');
    }
  }

  /** The customer approved the request in the dialog: save the sale with that payment. */
  function handlePaid(next: PaidRequest) {
    setPayOpen(false);
    setPaid(next);
    setProvider(next.provider);
    void submit(null, { method, paid: next });
  }

  /** Paid without a request (typed payment code): save the sale with what was typed. */
  function handleManual(input: { provider: Provider; reference: string }) {
    setPayOpen(false);
    setPaid(null);
    setProvider(input.provider);
    setReference(input.reference);
    void submit(null, { method, manual: input });
  }

  /**
   * Prescription, age and expiry checks happen before any money is taken, so a
   * cancelled sale never leaves a customer charged. The owner is warned, not
   * blocked: "Sell anyway" carries on, "Cancel" keeps the basket as it is.
   */
  function confirmWarnings(proceed: () => void) {
    const warnings = collectSaleWarnings(
      lines.map((line) => {
        const entry = index.get(line.variantId);
        return { label: entry?.label ?? line.variantId, saleWarning: entry?.saleWarning, expiryDate: entry?.expiryDate };
      }),
      todayLocal()
    );
    if (!hasSaleWarnings(warnings)) {
      proceed();
      return;
    }
    const list = (labels: string[]) => labels.map((label) => `• ${label}`).join('\n');
    const parts = [
      warnings.rx.length > 0 ? `${t('sale.warning.rx')}\n${list(warnings.rx)}` : null,
      warnings.age.length > 0 ? `${t('sale.warning.age')}\n${list(warnings.age)}` : null,
      ...warnings.other.map(({ label, warning }) => `${warning}\n• ${label}`),
      warnings.expired.length > 0 ? `${t('sale.warning.expired')}\n${list(warnings.expired)}` : null,
    ].filter(Boolean);
    Alert.alert(t('sale.warning.title'), parts.join('\n\n'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sale.warning.continue'), onPress: proceed },
    ]);
  }

  function openPay() {
    setError(null);
    setSplitOpen(false);
    confirmWarnings(() => setSheetOpen(true));
  }

  function payCash() {
    setMethod('cash');
    void submit(null, { method: 'cash' });
  }

  /** Mobile money is collected in the request dialog first; the sale saves once it is paid. */
  function payMobile() {
    setMethod('mobile_money');
    if (paid && paid.amount === priced.total) {
      void submit(null, { method: 'mobile_money', paid });
      return;
    }
    setDialogAfterSheet(true);
    setSheetOpen(false);
  }

  function paySplit() {
    if (cashAmount >= priced.total) {
      payCash();
      return;
    }
    setMethod('split');
    const remaining = priced.total - cashAmount;
    if (paid && paid.amount === remaining) {
      void submit(null, { method: 'split', paid });
      return;
    }
    setDialogAfterSheet(true);
    setSheetOpen(false);
  }

  async function submit(approved: StockShortfall[] | null, via: Via) {
    if (submitting) return;
    if (!user) {
      setError(t('sale.new.signInRequired'));
      setSheetOpen(true);
      return;
    }
    try {
      guard('sales.record');
      if (approved) guard('stock.override');
    } catch {
      setError(t('permission.denied'));
      setSheetOpen(true);
      return;
    }
    setError(null);
    setShortfalls(null);
    setLastVia(via);
    setSubmitting(true);
    try {
      const payments = via.paid
        ? buildPayments(via.method, via.paid.reference, via.paid.provider)
        : via.manual
          ? buildPayments(via.method, via.manual.reference, via.manual.provider)
          : buildPayments(via.method, saleReference, provider);
      const result = await recordSale(db, {
        recordedBy: user.id,
        lines,
        payments,
        // Only the owner can approve an override; the movement records who did.
        override: approved ? { approvedBy: user.id, shortfalls: approved } : undefined,
      });
      const confirmed = via.paid ?? (via.method !== 'cash' ? paidValid : null);
      if (confirmed) {
        // The provider confirmed this payment, so file it as received now:
        // the sale matches at once on its payment code, and pasting the same
        // message later is refused as a duplicate.
        try {
          await addPaymentMessage(db, {
            provider: confirmed.provider,
            amount: confirmed.amount,
            reference: confirmed.reference,
            sender: confirmed.phone,
            receivedAt: confirmed.at,
            rawMessage:
              `Request to pay approved by ${confirmed.phone}. Ref ${confirmed.reference}.` +
              (confirmed.fee ? ` Customer also paid a ${formatKwacha(confirmed.fee)} mobile money fee.` : ''),
            parsed: true,
          });
          await reconcileDay(db);
        } catch {
          // The sale is saved; checking money can still pair it later.
        }
      }
      setSheetOpen(false);
      setDone({ saleId: result.saleId, total: priced.total, method: via.method });
      setQuantityByVariant({});
      setPaid(null);
      setReference('');
      setCashPart('');
      setStockNote(null);
      setScanMessage(null);
      setQuery('');
    } catch (cause) {
      // Whatever went wrong is shown in the sheet, where the cashier is looking.
      if (cause instanceof InsufficientStockError) {
        setShortfalls(cause.shortfalls);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not save the sale');
      }
      setSheetOpen(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!can('sales.record')) {
    return (
      <Screen back title={t('nav.sell')}>
        <EmptyState
          icon="lock"
          title={t('permission.denied')}
          message={t('sale.noAccess')}
          action={{ label: t('common.back'), icon: 'arrow_back', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  if (done) {
    return (
      <SaleDone
        total={done.total}
        method={done.method}
        onNewSale={() => setDone(null)}
        onDone={() => router.back()}
        onReceipt={() => router.replace(`/sale/${done.saleId}`)}
      />
    );
  }

  const belowCostLabels = priced.belowCostLines.map((line) => index.get(line.variantId)?.label ?? line.variantId);

  return (
    <Screen
      back
      title={t('nav.sell')}
      footer={
        <Button
          label={lines.length === 0 ? t('sale.new.addFirst') : `${t('sale.pay')} · ${formatKwacha(priced.total)}`}
          icon="payments"
          disabled={lines.length === 0}
          loading={submitting}
          onPress={openPay}
        />
      }
    >
      <Text style={styles.ask}>{t('sale.ask')}</Text>

      {loadError ? (
        <ErrorState
          title={t('state.error.title')}
          message={t('state.error.message')}
          detail={loadError}
          retryLabel={t('common.retry')}
          onRetry={reloadProducts}
        />
      ) : null}
      {initialLoading ? <LoadingList label={t('state.loading')} count={2} /> : null}
      {!initialLoading && !loadError && products.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title={t('sale.new.noProducts.title')}
          message={t(can('products.manage') ? 'sale.new.noProducts.message' : 'products.empty.staffMessage')}
          action={
            can('products.manage')
              ? { label: t('products.addProduct'), icon: 'add', onPress: () => router.push('/product/new') }
              : undefined
          }
        />
      ) : null}

      {products.length > 0 ? (
        <View style={styles.finders}>
          {shop?.usesBarcodes ? (
            <Button
              label={t('sale.new.scan')}
              icon="barcode_scanner"
              variant="secondary"
              onPress={() => {
                setScanMessage(null);
                setScannerOpen(true);
              }}
            />
          ) : null}
          <SearchField value={query} onChangeText={setQuery} label={t('sale.new.search')} clearLabel={t('common.clearSearch')} />
        </View>
      ) : null}
      {scanMessage ? <Notice icon="barcode_scanner" text={scanMessage} /> : null}
      {stockNote ? <Notice icon="inventory_2" tone="warning" text={stockNote} /> : null}
      {needle && shownProducts.length === 0 ? (
        <Notice icon="search_off" text={t('products.noMatch.title', { query: query.trim() })} />
      ) : null}

      <View style={styles.grid}>
        {shownProducts.flatMap((product) =>
          product.variants.map((variant) => (
            <PickTile
              key={variant.id}
              productId={product.id}
              productName={product.name}
              category={product.category}
              label={variantLabel(product.name, variant)}
              price={variant.sellPrice}
              onHand={variant.quantity}
              quantity={quantityByVariant[variant.id] ?? 0}
              max={maxSellable(variant.quantity, canApproveOverride)}
              onAdd={() => setQuantity(variant.id, (quantityByVariant[variant.id] ?? 0) + 1)}
              onRemove={() => setQuantity(variant.id, (quantityByVariant[variant.id] ?? 0) - 1)}
            />
          ))
        )}
      </View>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onClosed={() => {
          if (!dialogAfterSheet) return;
          setDialogAfterSheet(false);
          setPayOpen(true);
        }}
        title={t('sale.pay.title')}
        closeLabel={t('common.close')}
      >
        <View style={styles.basket}>
          {priced.lines.map((line) => (
            <Row
              key={line.variantId}
              label={`${index.get(line.variantId)?.label ?? line.variantId} × ${line.quantity}`}
              value={formatKwacha(line.finalPrice)}
            />
          ))}
          {seesMoney && priced.discountTotal > 0 ? (
            <Row label={t('sale.new.discounts')} value={`− ${formatKwacha(priced.discountTotal)}`} />
          ) : null}
        </View>
        <View style={styles.totalRow}>
          <Icon name="payments" size={iconSize.xl} color={colors.text} />
          <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
            {formatKwacha(priced.total)}
          </Text>
        </View>

        {/* Money already received (e.g. the save then stopped on stock): say so, so nobody asks twice. */}
        {paid ? (
          <Notice
            icon="check_circle"
            tone="success"
            text={t('sale.pay.alreadyPaid', { amount: formatKwacha(paid.amount), code: paid.reference })}
          />
        ) : null}

        {seesMoney && belowCostLabels.length > 0 ? (
          <Notice icon="warning" tone="warning" text={`${t('sale.new.belowCost', { count: belowCostLabels.length })} ${belowCostLabels.join(', ')}`} />
        ) : null}

        {submitting ? (
          <View style={styles.saving}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : shortfalls ? (
          <View style={styles.override}>
            <Notice icon="error" tone="danger" text={t('sale.new.overrideTitle')} />
            {shortfalls.map((shortfall) => (
              <Text key={shortfall.variantId} style={styles.muted}>
                {t('sale.new.overrideLine', {
                  label: index.get(shortfall.variantId)?.label ?? shortfall.variantId,
                  onHand: shortfall.onHand,
                  requested: shortfall.requested,
                })}
              </Text>
            ))}
            {canApproveOverride ? (
              <Button label={t('sale.new.sellAnyway')} variant="danger" onPress={() => void submit(shortfalls, lastVia)} />
            ) : (
              <Text style={styles.muted}>{t('sale.new.overrideOwner')}</Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.payRow}>
              <BigTile icon="payments" label={t('sale.pay.cash')} tone="primary" onPress={payCash} />
              <BigTile icon="phone_iphone" label={t('sale.pay.mobile')} onPress={payMobile} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: splitOpen }}
              onPress={() => setSplitOpen((open) => !open)}
              android_ripple={{ color: colors.ripple }}
              style={styles.moreToggle}
            >
              <Icon name="call_split" size={iconSize.lg} color={colors.primaryInk} />
              <Text style={styles.moreText}>{t('sale.pay.more')}</Text>
              <Icon name={splitOpen ? 'expand_less' : 'expand_more'} size={iconSize.lg} color={colors.primaryInk} />
            </Pressable>
            {splitOpen ? (
              <View style={styles.split}>
                <Field
                  label={t('sale.new.cashPart')}
                  value={cashPart}
                  onChangeText={setCashPart}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  prefix="K"
                />
                <Row label={t('sale.new.remaining')} value={formatKwacha(Math.max(0, priced.total - cashAmount))} />
                <Button label={t('sale.pay.continue')} icon="arrow_forward" onPress={paySplit} />
              </View>
            ) : null}
          </>
        )}

        {error ? <FormError message={error} /> : null}
      </BottomSheet>

      {payOpen ? (
        <RequestToPayDialog
          amount={mobileAmount}
          initialProvider={provider}
          onClose={() => {
            // Cancelled: back to the choice of how to pay, not the product grid.
            setPayOpen(false);
            setSheetOpen(true);
          }}
          onPaid={handlePaid}
          onManual={handleManual}
        />
      ) : null}

      {scannerOpen ? (
        <Modal visible animationType="slide" onRequestClose={() => setScannerOpen(false)}>
          <BarcodeScanner onScanned={handleScanned} onClose={() => setScannerOpen(false)} />
        </Modal>
      ) : null}
    </Screen>
  );
}

/** One short line with its picture, so it is never colour or words alone. */
function Notice({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: 'barcode_scanner' | 'inventory_2' | 'search_off' | 'warning' | 'error' | 'check_circle';
  text: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'warning'
        ? colors.warning
        : tone === 'success'
          ? colors.success
          : colors.textMuted;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Icon name={icon} size={iconSize.lg} color={color} />
      <Text style={[styles.noticeText, { color: tone === 'neutral' ? colors.textMuted : colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  ask: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
  finders: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noticeText: { flex: 1, fontSize: typeScale.body, fontWeight: '600' },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  basket: { gap: spacing.xs },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  total: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: typeScale.money,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  payRow: { flexDirection: 'row', gap: spacing.sm },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.big,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  moreText: { flex: 1, fontSize: typeScale.body, fontWeight: '700', color: colors.primaryInk },
  split: { gap: spacing.sm },
  override: { gap: spacing.sm },
  saving: { minHeight: touch.big * 2, alignItems: 'center', justifyContent: 'center' },
}));
