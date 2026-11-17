import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button, Card, Choice, EmptyState, Field, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { priceSale, toNgwee, type LineInput, type PaymentInput, type Provider } from '@/core';
import { useProducts, useShop } from '@/db/hooks';
import { findVariantByBarcode, InsufficientStockError, recordSale, type StockShortfall } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, touch, typeScale } from '@/theme/tokens';

const PROVIDERS: Provider[] = ['MTN', 'Airtel', 'Zamtel'];

// Until staff sign-in lands (#29), every sale is attributed to the seeded cashier.
const RECORDED_BY = 'staff-1';

function Stepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove one"
        onPress={() => onChange(Math.max(0, value - 1))}
        style={styles.stepButton}
      >
        <Text style={styles.stepLabel}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add one"
        onPress={() => onChange(value + 1)}
        style={styles.stepButton}
      >
        <Text style={styles.stepLabel}>+</Text>
      </Pressable>
    </View>
  );
}

export default function NewSaleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { data: products, loading, error: loadError } = useProducts();
  const { data: shop } = useShop();

  const [quantityByVariant, setQuantityByVariant] = useState<Record<string, number>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [method, setMethod] = useState<'cash' | 'mobile_money' | 'split'>('cash');
  const [provider, setProvider] = useState<Provider>('MTN');
  const [reference, setReference] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<StockShortfall[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const index = useMemo(() => {
    const map = new Map<string, { label: string; sellPrice: number; buyPrice: number; discount?: LineInput['productDiscount'] }>();
    for (const product of products) {
      for (const variant of product.variants) {
        map.set(variant.id, {
          label: [product.name, variant.size, variant.colour].filter(Boolean).join(' · '),
          sellPrice: variant.sellPrice,
          buyPrice: variant.buyPrice,
          discount: product.discount,
        });
      }
    }
    return map;
  }, [products]);

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

  const payments = useMemo<PaymentInput[]>(() => {
    if (priced.total === 0) return [];
    if (method === 'cash') return [{ method: 'cash', amount: priced.total }];
    if (method === 'mobile_money') {
      return [{ method: 'mobile_money', provider, amount: priced.total, reference }];
    }
    // Split with nothing left for mobile money is just a cash sale.
    if (cashAmount === priced.total) return [{ method: 'cash', amount: priced.total }];
    return [
      { method: 'cash', amount: cashAmount },
      { method: 'mobile_money', provider, amount: priced.total - cashAmount, reference },
    ];
  }, [method, priced.total, provider, reference, cashAmount]);

  // Any basket change voids an override shown for the old basket.
  const setQuantity = (variantId: string, next: number) => {
    setShortfalls(null);
    setQuantityByVariant((current) => ({ ...current, [variantId]: Math.min(99, Math.max(0, next)) }));
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

  async function submit(approved: StockShortfall[] | null) {
    if (submitting) return;
    setError(null);
    setShortfalls(null);
    setSubmitting(true);
    try {
      const result = await recordSale(db, {
        recordedBy: RECORDED_BY,
        lines,
        payments,
        // Until staff sign-in (#29) there is no separate owner to check, so the
        // approval is attributed to the signed-in user and noted on the movement.
        override: approved ? { approvedBy: RECORDED_BY, shortfalls: approved } : undefined,
      });
      setQuantityByVariant({});
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
    <Screen
      title={t('sale.new.title')}
      footer={
        <Button
          label={
            priced.total > 0
              ? `${t('sale.new.confirm')} · ${formatKwacha(priced.total)}`
              : t('sale.new.confirm')
          }
          disabled={lines.length === 0 || submitting}
          onPress={() => submit(null)}
        />
      }
    >
      {loadError ? <EmptyState message={loadError} /> : null}
      {loading ? <Text style={styles.muted}>{t('common.syncing')}</Text> : null}

      <SectionTitle>{t('sale.new.addItem')}</SectionTitle>
      {shop?.usesBarcodes ? (
        <Button
          label={t('sale.new.scan')}
          variant="secondary"
          onPress={() => {
            setScanMessage(null);
            setScannerOpen(true);
          }}
        />
      ) : null}
      {scanMessage ? <Text style={styles.muted}>{scanMessage}</Text> : null}
      {products.map((product) => (
        <Card key={product.id}>
          <Text style={styles.productName}>{product.name}</Text>
          {product.variants.map((variant) => {
            const quantity = quantityByVariant[variant.id] ?? 0;
            const label = [variant.size, variant.colour].filter(Boolean).join(' · ') || 'Single';
            return (
              <View key={variant.id} style={styles.variantRow}>
                <View style={styles.variantText}>
                  <Text style={styles.variantLabel}>{label}</Text>
                  <Text style={styles.muted}>
                    {formatKwacha(variant.sellPrice)} · {t('sale.new.stockLeft', { count: variant.quantity })}
                  </Text>
                </View>
                <Stepper value={quantity} onChange={(next) => setQuantity(variant.id, next)} />
              </View>
            );
          })}
        </Card>
      ))}

      <SectionTitle>{t('sales.items')}</SectionTitle>
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
            <Row label={t('sale.new.subtotal')} value={formatKwacha(priced.subtotal)} />
            <Row label={t('sale.new.discounts')} value={formatKwacha(priced.discountTotal)} />
            <Row label={t('sales.total')} value={formatKwacha(priced.total)} emphasis />
          </View>
        </Card>
      )}

      {belowCostLabels.length > 0 ? (
        <Card style={styles.warningCard}>
          <Pill label="!" tone="warning" />
          <Text style={styles.warningText}>
            {t('sale.new.belowCost', { count: belowCostLabels.length })}
          </Text>
          {belowCostLabels.map((label) => (
            <Text key={label} style={styles.muted}>
              {label}
            </Text>
          ))}
        </Card>
      ) : null}

      {shortfalls ? (
        <Card style={styles.dangerCard}>
          <Text style={styles.warningText}>{t('sale.new.overrideTitle')}</Text>
          {shortfalls.map((shortfall) => (
            <Text key={shortfall.variantId} style={styles.muted}>
              {t('sale.new.overrideLine', {
                label: index.get(shortfall.variantId)?.label ?? shortfall.variantId,
                onHand: shortfall.onHand,
                requested: shortfall.requested,
              })}
            </Text>
          ))}
          <Button
            label={t('sale.new.sellAnyway')}
            variant="danger"
            disabled={submitting}
            onPress={() => submit(shortfalls)}
          />
        </Card>
      ) : null}

      <SectionTitle>{t('sale.new.paymentMethod')}</SectionTitle>
      <View style={styles.methods}>
        <Choice label={t('sale.new.cash')} selected={method === 'cash'} onPress={() => setMethod('cash')} />
        <Choice
          label={t('sale.new.mobileMoney')}
          selected={method === 'mobile_money'}
          onPress={() => setMethod('mobile_money')}
        />
        <Choice label={t('sale.new.split')} selected={method === 'split'} onPress={() => setMethod('split')} />
      </View>

      {method !== 'cash' ? (
        <Card>
          <Text style={styles.muted}>{t('sale.new.provider')}</Text>
          <View style={styles.providers}>
            {PROVIDERS.map((option) => (
              <Choice
                key={option}
                label={option}
                selected={provider === option}
                onPress={() => setProvider(option)}
              />
            ))}
          </View>
          <Field
            label={t('sale.new.reference')}
            value={reference}
            onChangeText={setReference}
            placeholder="MP2607.1122.A84721"
          />
          <Text style={styles.muted}>{t('sale.new.referenceHint')}</Text>
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
          />
          <Row
            label={t('sale.new.remaining')}
            value={formatKwacha(Math.max(0, priced.total - cashAmount))}
          />
        </Card>
      ) : null}

      {error ? (
        <Card style={styles.dangerCard}>
          <Text style={styles.warningText}>{error}</Text>
        </Card>
      ) : null}

      {scannerOpen ? (
        <Modal visible animationType="slide" onRequestClose={() => setScannerOpen(false)}>
          <BarcodeScanner onScanned={handleScanned} onClose={() => setScannerOpen(false)} />
        </Modal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  productName: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  stepButton: { width: touch.minWidth, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  stepLabel: { fontSize: typeScale.heading, color: colors.text, fontWeight: '700' },
  stepValue: { minWidth: 32, textAlign: 'center', fontSize: typeScale.body, color: colors.text },
  totals: { marginTop: spacing.sm, gap: spacing.xs },
  warningCard: { backgroundColor: colors.warningSoft, gap: spacing.xs },
  dangerCard: { backgroundColor: colors.dangerSoft, gap: spacing.xs },
  warningText: { fontSize: typeScale.label, color: colors.text, fontWeight: '600' },
  methods: { gap: spacing.sm },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
