import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { Notice } from '@/components/auth';
import {
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  LoadingList,
  Pill,
  Row,
  Screen,
  SectionTitle,
  StatTile,
} from '@/components/ui';
import { isValidEan13, parsePrice, sanitisePriceInput } from '@/core';
import { useMovements, useProducts, useShop } from '@/db/hooks';
import { restockVariant, setVariantBarcode, type MovementRow } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha, formatTime, localDayKey } from '@/lib/format';
import { labelHtml } from '@/lib/label';
import { colors, fonts, iconSize, spacing, themed, typeScale } from '@/theme/tokens';

/**
 * Newest first, with the stock level right after each change, worked back
 * from today's count, and a flag where a new day starts.
 */
function withBalances(movements: MovementRow[], current: number) {
  let balance = current;
  let lastDay = '';
  return movements.map((movement) => {
    const day = localDayKey(movement.createdAt);
    const row = { movement, balance, newDay: day !== lastDay };
    lastDay = day;
    balance -= movement.quantityChange;
    return row;
  });
}

export default function ProductScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const guard = usePermissionGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: products, loading, error, reload: reloadProducts } = useProducts();
  const { data: shop } = useShop();

  const product = products.find((candidate) => candidate.id === id);
  const [chosenVariantId, setChosenVariantId] = useState<string | null>(null);
  const selectedVariantId = chosenVariantId ?? product?.variants[0]?.id ?? '';
  const selectedVariant = product?.variants.find((variant) => variant.id === selectedVariantId);

  const { data: movements, reload: reloadMovements } = useMovements(selectedVariantId);

  const [quantity, setQuantity] = useState('1');
  // null means "show the stored cost"; a string means the owner is editing it.
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const buyPrice = priceDraft ?? (selectedVariant ? (selectedVariant.buyPrice / 100).toFixed(2) : '');

  async function handleRestock() {
    if (!selectedVariant) return;
    setSubmitError(null);
    setMessage(null);
    try {
      guard('products.manage');
    } catch {
      setSubmitError(t('permission.denied'));
      return;
    }
    setSubmitting(true);
    try {
      // An empty price keeps the current one; anything typed must be a real price.
      const typedPrice = buyPrice.trim() === '' ? null : parsePrice(buyPrice);
      if (typedPrice && !typedPrice.ok) {
        setSubmitError(t(`price.error.${typedPrice.error}`, { field: t('products.restockPrice') }));
        setSubmitting(false);
        return;
      }
      const result = await restockVariant(db, {
        variantId: selectedVariant.id,
        quantity: Number.parseInt(quantity, 10),
        buyPrice: typedPrice ? typedPrice.ngwee : undefined,
        note: note.trim() || undefined,
      });
      setMessage(
        t('products.restockDone', { added: result.quantityAdded, onHand: result.quantityOnHand })
      );
      setQuantity('1');
      setNote('');
      setPriceDraft(null);
      reloadProducts();
      reloadMovements();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not restock');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateBarcode() {
    if (!selectedVariant || submitting) return;
    setSubmitError(null);
    setMessage(null);
    try {
      guard('products.manage');
    } catch {
      setSubmitError(t('permission.denied'));
      return;
    }
    setSubmitting(true);
    try {
      const code = await setVariantBarcode(db, selectedVariant.id);
      setMessage(t('products.barcodeAdded', { code }));
      reloadProducts();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not add a barcode');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrintLabel(code: string) {
    if (!selectedVariant) return;
    setSubmitError(null);
    try {
      await Print.printAsync({
        html: labelHtml({
          shopName: shop?.name ?? 'StockSure',
          productName: product?.name ?? '',
          priceText: formatKwacha(selectedVariant.sellPrice),
          code,
        }),
      });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not open printing');
    }
  }

  if (loading && !product) {
    return (
      <Screen back title={t('products.title')}>
        <LoadingList label={t('state.loading')} hero count={2} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen back title={t('products.title')}>
        <ErrorState
          title={t('state.error.title')}
          message={t('state.error.message')}
          detail={error}
          retryLabel={t('common.retry')}
          onRetry={reloadProducts}
        />
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen back title={t('products.title')}>
        <EmptyState
          icon="inventory_2"
          title={t('state.notFound.title')}
          message={t('state.notFound.message')}
          secondary={{ label: t('common.back'), icon: 'arrow_back', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  return (
    <Screen back title={product.name} subtitle={product.category}>
      <View style={styles.stats}>
        <StatTile value={formatKwacha(product.defaultSellPrice)} label={t('products.sellPrice')} />
        <StatTile
          value={formatKwacha(product.defaultSellPrice - product.defaultBuyPrice)}
          label={t('products.margin')}
          tone={product.defaultSellPrice - product.defaultBuyPrice < 0 ? 'danger' : 'success'}
        />
      </View>

      {product.variants.length > 1 ? (
        <>
          <SectionTitle>{t('products.selectVariant')}</SectionTitle>
          <View style={styles.choices}>
            {product.variants.map((variant) => (
              <Choice
                key={variant.id}
                label={[variant.size, variant.colour].filter(Boolean).join(' · ') || 'Single'}
                selected={variant.id === selectedVariantId}
                onPress={() => {
                  setChosenVariantId(variant.id);
                  setPriceDraft(null);
                }}
              />
            ))}
          </View>
        </>
      ) : null}

      {selectedVariant ? (
        <>
          <SectionTitle>{t('products.inStock')}</SectionTitle>
          <Card>
            <View style={styles.headerRow}>
              <Text style={styles.name}>
                {[selectedVariant.size, selectedVariant.colour].filter(Boolean).join(' · ') || t('products.stockNow')}
              </Text>
              <Pill
                label={
                  selectedVariant.quantity <= 0
                    ? t('products.filter.out')
                    : t('products.left', { count: selectedVariant.quantity })
                }
                tone={
                  selectedVariant.state === 'out'
                    ? 'danger'
                    : selectedVariant.state === 'low'
                      ? 'warning'
                      : 'success'
                }
              />
            </View>
            {selectedVariant.barcode ? (
              <>
                <Row label="Barcode" value={selectedVariant.barcode} />
                {isValidEan13(selectedVariant.barcode) ? (
                  <Button
                    label={t('products.printLabel')}
                    icon="print"
                    variant="secondary"
                    onPress={() => handlePrintLabel(selectedVariant.barcode!)}
                  />
                ) : null}
              </>
            ) : shop?.usesBarcodes ? (
              // New products get one automatically; this covers products made
              // before barcodes were switched on.
              <>
                <Row label="Barcode" value={t('products.noBarcodeYet')} />
                <Button
                  label={t('products.generateBarcode')}
                  icon="barcode"
                  variant="secondary"
                  disabled={submitting}
                  loading={submitting}
                  onPress={handleGenerateBarcode}
                />
              </>
            ) : (
              <Row label="Barcode" value={t('common.notYet')} />
            )}
            <Row label={t('products.buyPrice')} value={formatKwacha(selectedVariant.buyPrice)} />
            <Row label={t('products.sellPrice')} value={formatKwacha(selectedVariant.sellPrice)} />
          </Card>

          <SectionTitle>{t('products.restock')}</SectionTitle>
          <Card>
            <Field
              label={t('products.restockQty')}
              value={quantity}
              onChangeText={(v) => setQuantity(v.replace(/\D/g, ''))}
              keyboardType="numeric"
            />
            <Field
              label={t('products.restockPrice')}
              value={buyPrice}
              onChangeText={(v) => setPriceDraft(sanitisePriceInput(v))}
              keyboardType="decimal-pad"
              prefix="K"
            />
            <Field
              label={t('products.restockNote')}
              value={note}
              onChangeText={setNote}
              placeholder={t('common.optional')}
            />
            <Button
              label={t('products.restock')}
              icon="add_box"
              disabled={submitting}
              loading={submitting}
              onPress={handleRestock}
            />
            {message ? <Notice tone="success">{message}</Notice> : null}
            {submitError ? <Notice tone="error">{submitError}</Notice> : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('products.recentMovements')}</SectionTitle>
      <Card>
        {movements.length === 0 ? (
          <EmptyState message={t('common.none')} />
        ) : (
          withBalances(movements, selectedVariant?.quantity ?? 0).map(({ movement, balance, newDay }) => (
            <View key={movement.id}>
              {newDay ? <Text style={styles.movementDay}>{formatDay(movement.createdAt)}</Text> : null}
              <View style={styles.movement}>
                <Icon
                  name={movement.quantityChange > 0 ? 'arrow_upward' : 'arrow_downward'}
                  size={iconSize.md}
                  color={movement.quantityChange > 0 ? colors.success : colors.textMuted}
                />
                <View style={styles.movementText}>
                  <Text style={styles.movementLabel} numberOfLines={1}>
                    {`${t(`movement.${movement.reason}`)} · ${formatTime(movement.createdAt)}`}
                  </Text>
                  {movement.byName || movement.note ? (
                    <Text style={styles.movementMeta} numberOfLines={2}>
                      {[movement.byName, movement.note].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.movementRight}>
                  <Text style={[styles.movementQty, movement.quantityChange > 0 && styles.movementIn]}>
                    {`${movement.quantityChange > 0 ? '+' : ''}${movement.quantityChange}`}
                  </Text>
                  <Text style={styles.movementMeta}>{t('products.balanceAfter', { count: balance })}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  movement: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  movementText: { flex: 1, gap: 2 },
  movementLabel: { fontSize: typeScale.body, color: colors.text },
  movementMeta: { fontSize: typeScale.caption, color: colors.textMuted },
  movementRight: { alignItems: 'flex-end', gap: 2 },
  movementDay: {
    fontSize: typeScale.label,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  movementQty: {
    fontFamily: fonts.display,
    fontSize: typeScale.body,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  movementIn: { color: colors.success },
}));
