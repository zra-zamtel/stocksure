import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { useAuth } from '@/auth/session';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { RequestToPayDialog, type PaidRequest } from '@/components/request-to-pay';
import {
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Icon,
  LoadingList,
  Row,
  Screen,
  SearchField,
  SectionTitle,
} from '@/components/ui';
import { maxSellable, priceSale, toNgwee, variantLabel, type LineInput, type PaymentInput, type Provider } from '@/core';
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


function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (next: number) => void }) {
  const atMax = value >= max;
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove one"
        onPress={() => onChange(Math.max(0, value - 1))}
        disabled={value === 0}
        android_ripple={{ color: colors.ripple }}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepPressed, value === 0 && styles.stepIdle]}
      >
        <Icon name="remove" size={iconSize.md} color={value === 0 ? colors.textMuted : colors.text} />
      </Pressable>
      <Text style={[styles.stepValue, value > 0 && styles.stepValueOn]}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add one"
        accessibilityState={{ disabled: atMax }}
        onPress={() => onChange(value + 1)}
        android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
        style={({ pressed }) => [
          styles.stepButton,
          styles.stepAdd,
          pressed && styles.stepPressed,
          atMax && styles.stepButtonOff,
        ]}
      >
        <Icon name="add" size={iconSize.md} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

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
  const [method, setMethod] = useState<'cash' | 'mobile_money' | 'split'>('cash');
  const [provider, setProvider] = useState<Provider>('MTN');
  const [reference, setReference] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<StockShortfall[] | null>(null);
  const [stockNote, setStockNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState<PaidRequest | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const index = useMemo(() => {
    const map = new Map<string, { label: string; sellPrice: number; buyPrice: number; onHand: number; discount?: LineInput['productDiscount'] }>();
    for (const product of products) {
      for (const variant of product.variants) {
        map.set(variant.id, {
          label: variantLabel(product.name, variant),
          sellPrice: variant.sellPrice,
          buyPrice: variant.buyPrice,
          onHand: variant.quantity,
          discount: product.discount,
        });
      }
    }
    return map;
  }, [products]);

  const needle = query.trim().toLowerCase();
  // Products already in the basket stay visible while searching, so their
  // steppers do not vanish mid-sale.
  const shownProducts = needle
    ? products.filter(
        (product) =>
          product.variants.some((variant) => (quantityByVariant[variant.id] ?? 0) > 0) ||
          [product.name, product.category ?? '', ...product.variants.map((variant) => variant.barcode ?? '')]
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

  const buildPayments = (ref: string, network: Provider): PaymentInput[] => {
    if (priced.total === 0) return [];
    if (method === 'cash') return [{ method: 'cash', amount: priced.total }];
    if (method === 'mobile_money') {
      return [{ method: 'mobile_money', provider: network, amount: priced.total, reference: ref }];
    }
    // Split with nothing left for mobile money is just a cash sale.
    if (cashAmount === priced.total) return [{ method: 'cash', amount: priced.total }];
    return [
      { method: 'cash', amount: cashAmount },
      { method: 'mobile_money', provider: network, amount: priced.total - cashAmount, reference: ref },
    ];
  };
  const payments = buildPayments(saleReference, provider);
  // Mobile money is collected in the dialog first; the sale saves once it is paid.
  const needsMobileMoney = method !== 'cash' && mobileAmount > 0 && !paidValid;

  // Any basket change voids an override shown for the old basket.
  const setQuantity = (variantId: string, next: number) => {
    setShortfalls(null);
    const entry = index.get(variantId);
    // Staff (and an owner who has staff) cannot sell past what is on hand, so
    // the basket stops there and says why. Someone who can approve an override
    // may go over; they are warned on the line and asked to confirm at the end.
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
    void submit(null, { paid: next });
  }

  /** Paid without a request (typed reference): save the sale with what was typed. */
  function handleManual(input: { provider: Provider; reference: string }) {
    setPayOpen(false);
    setPaid(null);
    setProvider(input.provider);
    setReference(input.reference);
    void submit(null, { manual: input });
  }

  function chooseMethod(next: 'cash' | 'mobile_money' | 'split') {
    setMethod(next);
    // Mobile money goes straight to the payment dialog once there is something to sell.
    if (next === 'mobile_money' && lines.length > 0) setPayOpen(true);
  }

  async function submit(
    approved: StockShortfall[] | null,
    via?: { paid?: PaidRequest; manual?: { provider: Provider; reference: string } },
  ) {
    if (submitting) return;
    if (!user) {
      setError(t('sale.new.signInRequired'));
      return;
    }
    try {
      guard('sales.record');
      if (approved) guard('stock.override');
    } catch {
      setError(t('permission.denied'));
      return;
    }
    setError(null);
    setShortfalls(null);
    setSubmitting(true);
    try {
      const result = await recordSale(db, {
        recordedBy: user.id,
        lines,
        payments: via?.paid
          ? buildPayments(via.paid.reference, via.paid.provider)
          : via?.manual
            ? buildPayments(via.manual.reference, via.manual.provider)
            : payments,
        // Only the owner can approve an override; the movement records who did.
        override: approved ? { approvedBy: user.id, shortfalls: approved } : undefined,
      });
      const confirmed = via?.paid ?? paidValid;
      if (confirmed) {
        // The provider confirmed this payment, so file it as received now:
        // the sale matches at once on its reference, and pasting the same
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
          // The sale is saved; Reconcile can still pair it later.
        }
      }
      setQuantityByVariant({});
      setPaid(null);
      router.replace(`/sale/${result.saleId}`);
    } catch (cause) {
      if (cause instanceof InsufficientStockError) {
        setShortfalls(cause.shortfalls);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not save the sale');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const belowCostLabels = priced.belowCostLines.map(
    (line) => index.get(line.variantId)?.label ?? line.variantId
  );

  return (
    <Screen back
      title={t('sale.new.title')}
      footer={
        <Button
          label={
            needsMobileMoney
              ? `${t('sale.new.getPaid')} · ${formatKwacha(mobileAmount)}`
              : priced.total > 0
                ? `${t('sale.new.confirm')} · ${formatKwacha(priced.total)}`
                : // Disabled until something is added: the label says what to do.
                  t('sale.new.addFirst')
          }
          disabled={lines.length === 0}
          loading={submitting}
          onPress={() => (needsMobileMoney ? setPayOpen(true) : submit(null))}
        />
      }
    >
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

      <SectionTitle>{t('sale.new.addItem')}</SectionTitle>
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
      {scanMessage ? <Text style={styles.muted}>{scanMessage}</Text> : null}
      {stockNote ? <Text style={styles.stockWarning}>{stockNote}</Text> : null}
      {products.length > 0 ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          label={t('sale.new.search')}
          clearLabel={t('common.clearSearch')}
        />
      ) : null}
      {needle && shownProducts.length === 0 ? (
        <Text style={styles.muted}>{t('products.noMatch.title', { query: query.trim() })}</Text>
      ) : null}
      {shownProducts.map((product) => (
        <Card
          key={product.id}
          style={product.variants.some((variant) => (quantityByVariant[variant.id] ?? 0) > 0) && styles.pickedCard}
        >
          <Text style={styles.productName}>{product.name}</Text>
          {product.variants.map((variant) => {
            const quantity = quantityByVariant[variant.id] ?? 0;
            // A product with one plain variant needs no second name under it.
            const label = variantLabel('', variant);
            return (
              <View key={variant.id} style={styles.variantRow}>
                <View style={styles.variantText}>
                  {label ? <Text style={styles.variantLabel}>{label}</Text> : null}
                  <Text style={styles.muted}>
                    {formatKwacha(variant.sellPrice)} · {t('sale.new.stockLeft', { count: variant.quantity })}
                  </Text>
                  {quantity > variant.quantity ? (
                    <Text style={styles.stockWarning}>{t('sale.new.overStock', { count: Math.max(0, variant.quantity) })}</Text>
                  ) : null}
                </View>
                <Stepper
                  value={quantity}
                  max={maxSellable(variant.quantity, canApproveOverride)}
                  onChange={(next) => setQuantity(variant.id, next)}
                />
              </View>
            );
          })}
        </Card>
      ))}

      <SectionTitle>{t('sale.new.basket')}</SectionTitle>
      {lines.length === 0 ? (
        <EmptyState message={t('sale.new.empty')} />
      ) : (
        <Card>
          {priced.lines.map((line) => (
            <Row
              key={line.variantId}
              label={`${index.get(line.variantId)?.label ?? line.variantId} × ${line.quantity}`}
              value={formatKwacha(line.finalPrice)}
            />
          ))}
          <View style={styles.totals}>
            {seesMoney ? (
              <>
                <Row label={t('sale.new.subtotal')} value={formatKwacha(priced.subtotal)} />
                <Row label={t('sale.new.discounts')} value={formatKwacha(priced.discountTotal)} />
              </>
            ) : null}
            <Row label={t('sales.total')} value={formatKwacha(priced.total)} emphasis />
          </View>
        </Card>
      )}

      {seesMoney && belowCostLabels.length > 0 ? (
        <Card style={styles.warningCard}>
          <View style={styles.alertHead}>
            <Icon name="warning" size={iconSize.md} color={colors.warning} />
            <Text style={[styles.warningText, styles.flex]}>
              {t('sale.new.belowCost', { count: belowCostLabels.length })}
            </Text>
          </View>
          {belowCostLabels.map((label) => (
            <Text key={label} style={styles.muted}>
              {label}
            </Text>
          ))}
        </Card>
      ) : null}

      {shortfalls ? (
        <Card style={styles.dangerCard}>
          <View style={styles.alertHead}>
            <Icon name="error" size={iconSize.md} color={colors.danger} />
            <Text style={[styles.warningText, styles.flex]}>{t('sale.new.overrideTitle')}</Text>
          </View>
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
            <Button
              label={t('sale.new.sellAnyway')}
              variant="danger"
              disabled={submitting}
              loading={submitting}
              onPress={() => submit(shortfalls)}
            />
          ) : (
            <Text style={styles.warningText}>{t('sale.new.overrideOwner')}</Text>
          )}
        </Card>
      ) : null}

      <SectionTitle>{t('sale.new.paymentMethod')}</SectionTitle>
      <View style={styles.methods}>
        <Choice
          label={t('sale.new.cash')}
          icon="payments"
          selected={method === 'cash'}
          onPress={() => chooseMethod('cash')}
        />
        <Choice
          label={t('sale.new.mobileMoney')}
          icon="phone_iphone"
          selected={method === 'mobile_money'}
          onPress={() => chooseMethod('mobile_money')}
        />
        <Choice
          label={t('sale.new.split')}
          icon="call_split"
          selected={method === 'split'}
          onPress={() => chooseMethod('split')}
        />
      </View>

      {method !== 'cash' && paidValid ? (
        <Card style={styles.paidCard}>
          <View style={styles.alertHead}>
            <Icon name="check_circle" size={iconSize.md} color={colors.success} />
            <Text style={[styles.paidText, styles.flex]}>
            {t('rtp.paid', { amount: formatKwacha(paidValid.amount), reference: paidValid.reference })}
            </Text>
          </View>
        </Card>
      ) : null}

      {method === 'split' ? (
        <Card>
          <Field
            label={t('sale.new.cashPart')}
            value={cashPart}
            onChangeText={setCashPart}
            placeholder="0.00"
            keyboardType="decimal-pad"
            prefix="K"
          />
          <Row
            label={t('sale.new.remaining')}
            value={formatKwacha(Math.max(0, priced.total - cashAmount))}
          />
        </Card>
      ) : null}

      {error ? <FormError message={error} /> : null}

      {payOpen ? (
        <RequestToPayDialog
          amount={mobileAmount}
          initialProvider={provider}
          onClose={() => setPayOpen(false)}
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

const styles = themed(() => StyleSheet.create({
  productName: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  pickedCard: { borderColor: colors.primary, borderWidth: 1.5 },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.minHeight,
  },
  variantText: { flexShrink: 1, gap: 2 },
  variantLabel: { fontSize: typeScale.body, color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepButton: {
    width: touch.minWidth,
    height: touch.minHeight,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  stepAdd: { backgroundColor: colors.primary },
  stepIdle: { opacity: 0.5 },
  stepPressed: { opacity: 0.75 },
  stepValue: {
    minWidth: 32,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: typeScale.heading,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  stepValueOn: { color: colors.text },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  // At the stock on hand: dimmed, but still tappable for an owner-approved oversell.
  stepButtonOff: { opacity: 0.35 },
  stockWarning: { fontSize: typeScale.label, color: colors.warning, fontWeight: '700' },
  totals: { marginTop: spacing.sm, gap: spacing.xs },
  warningCard: { backgroundColor: colors.warningSoft, gap: spacing.xs },
  dangerCard: { backgroundColor: colors.dangerSoft, gap: spacing.xs },
  warningText: { fontSize: typeScale.label, color: colors.text, fontWeight: '600' },
  methods: { gap: spacing.sm },
  paidCard: { backgroundColor: colors.successSoft },
  paidText: { fontSize: typeScale.body, color: colors.success, fontWeight: '600' },
}));
