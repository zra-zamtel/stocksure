import * as Print from 'expo-print';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Choice, EmptyState, Field, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { isValidEan13, toNgwee } from '@/core';
import { useMovements, useProducts, useShop } from '@/db/hooks';
import { restockVariant, setVariantBarcode } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { labelHtml } from '@/lib/label';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function ProductScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
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
  const [barcodeMessage, setBarcodeMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const buyPrice = priceDraft ?? (selectedVariant ? (selectedVariant.buyPrice / 100).toFixed(2) : '');

  async function handleRestock() {
    if (!selectedVariant) return;
    setSubmitError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const parsedPrice = Number.parseFloat(buyPrice.replace(',', '.'));
      const result = await restockVariant(db, {
        variantId: selectedVariant.id,
        quantity: Number.parseInt(quantity, 10),
        buyPrice: Number.isFinite(parsedPrice) ? toNgwee(parsedPrice) : undefined,
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

  async function handleGenerateBarcode() {
    if (!selectedVariant) return;
    setSubmitError(null);
    setBarcodeMessage(null);
    try {
      const code = await setVariantBarcode(db, selectedVariant.id);
      setBarcodeMessage(t('products.barcodeAdded', { code }));
      reloadProducts();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not add a barcode');
    }
  }

  if (loading && !product) {
    return (
      <Screen title={t('products.title')}>
        <Text style={styles.muted}>{t('common.syncing')}</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title={t('products.title')}>
        <EmptyState message={error} />
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen title={t('products.title')}>
        <EmptyState message="Product not found." />
      </Screen>
    );
  }

  return (
    <Screen title={product.name} subtitle={product.category}>
      <Card>
        <Row label={t('products.buyPrice')} value={formatKwacha(product.defaultBuyPrice)} />
        <Row label={t('products.sellPrice')} value={formatKwacha(product.defaultSellPrice)} />
        <Row
          label={t('products.margin')}
          value={formatKwacha(product.defaultSellPrice - product.defaultBuyPrice)}
        />
      </Card>

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
                {[selectedVariant.size, selectedVariant.colour].filter(Boolean).join(' · ') || 'Single'}
              </Text>
              <Pill
                label={`${selectedVariant.quantity}`}
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
                    variant="secondary"
                    onPress={() => handlePrintLabel(selectedVariant.barcode!)}
                  />
                ) : null}
              </>
            ) : shop?.usesBarcodes ? (
              <>
                <Row label="Barcode" value={t('products.noBarcodeYet')} />
                <Button
                  label={t('products.generateBarcode')}
                  variant="secondary"
                  onPress={handleGenerateBarcode}
                />
              </>
            ) : (
              <Row label="Barcode" value={t('common.notYet')} />
            )}
            {barcodeMessage ? <Text style={styles.success}>{barcodeMessage}</Text> : null}
            <Row label={t('products.buyPrice')} value={formatKwacha(selectedVariant.buyPrice)} />
            <Row label={t('products.sellPrice')} value={formatKwacha(selectedVariant.sellPrice)} />
          </Card>

          <SectionTitle>{t('products.restock')}</SectionTitle>
          <Card>
            <Field
              label={t('products.restockQty')}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
            />
            <Field
              label={t('products.restockPrice')}
              value={buyPrice}
              onChangeText={setPriceDraft}
              keyboardType="decimal-pad"
            />
            <Field
              label={t('products.restockNote')}
              value={note}
              onChangeText={setNote}
              placeholder={t('common.optional')}
            />
            <Button
              label={t('products.restock')}
              disabled={submitting}
              onPress={handleRestock}
            />
            {message ? <Text style={styles.success}>{message}</Text> : null}
            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('products.recentMovements')}</SectionTitle>
      <Card>
        {movements.length === 0 ? (
          <EmptyState message={t('common.none')} />
        ) : (
          movements.map((movement) => (
            <Row
              key={movement.id}
              label={`${t(`movement.${movement.reason}`)} · ${movement.createdAt.slice(0, 10)}`}
              value={`${movement.quantityChange > 0 ? '+' : ''}${movement.quantityChange}`}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
