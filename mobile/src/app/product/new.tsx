import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { usePermissionGuard } from '@/auth/permissions';
import { BarcodeLabel } from '@/components/barcode-label';
import { Button, Card, Choice, Field, Screen, SectionTitle } from '@/components/ui';
import {
  isValidEan13,
  normaliseBarcode,
  parsePrice,
  profileForShop,
  sanitisePriceInput,
  type PriceError,
} from '@/core';
import { useShop } from '@/db/hooks';
import { createProduct } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { labelHtml } from '@/lib/label';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

export default function NewProductScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const guard = usePermissionGuard();
  const { barcode: scannedBarcode, from } = useLocalSearchParams<{ barcode?: string; from?: string }>();
  const { data: shop } = useShop();
  const onboarding = from === 'onboarding';
  // The trade decides which variant fields and category suggestions show.
  const profile = profileForShop(shop);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [barcode, setBarcode] = useState(scannedBarcode ?? '');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  // Empty, not a pre-filled "1": a real-looking value is easy to save by mistake.
  const [quantity, setQuantity] = useState('');
  // Values for the profile's variant axes, keyed by axis key (e.g. size, shade, pack).
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [lowStock, setLowStock] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const labelRef = useRef<ComponentRef<typeof View>>(null);
  const usesBarcodes = shop?.usesBarcodes ?? false;
  // Compare what will actually be saved: a 12-digit UPC-A is stored padded to EAN-13.
  const savedCode = barcode.trim() === '' ? '' : normaliseBarcode(barcode);
  const scannable = savedCode !== '' && isValidEan13(savedCode);

  const priceMessage = (field: string, code: PriceError) => t(`price.error.${code}`, { field });
  // Selling below what it cost is allowed, but the owner is told while typing.
  const typedBuy = parsePrice(buyPrice);
  const typedSell = parsePrice(sellPrice);
  const lossPerUnit = typedBuy.ok && typedSell.ok && typedSell.ngwee < typedBuy.ngwee ? typedBuy.ngwee - typedSell.ngwee : 0;
  // Profit per unit while pricing, so a typo shows before saving.
  const profitPerUnit =
    typedBuy.ok && typedSell.ok && typedSell.ngwee >= typedBuy.ngwee && typedSell.ngwee > 0
      ? typedSell.ngwee - typedBuy.ngwee
      : null;
  const markupPercent =
    profitPerUnit !== null && typedBuy.ok && typedBuy.ngwee > 0
      ? ((profitPerUnit / typedBuy.ngwee) * 100).toFixed(1)
      : null;

  async function handleSave() {
    setError(null);
    setMessage(null);

    try {
      guard('products.manage');
    } catch {
      setError(t('permission.denied'));
      return;
    }

    const buyResult = parsePrice(buyPrice);
    const sellResult = parsePrice(sellPrice);
    // Salaula pieces are one of a kind, so the opening stock is always one.
    const opening = profile.uniqueItems ? 1 : Number.parseInt(quantity, 10);

    if (!name.trim()) return setError('Product name is required');
    if (!buyResult.ok) return setError(priceMessage(t('products.buyPrice'), buyResult.error));
    if (!sellResult.ok) return setError(priceMessage(t('products.sellPrice'), sellResult.error));
    if (!profile.uniqueItems && quantity.trim() === '') return setError(t('product.new.error.qty'));
    if (!Number.isInteger(opening) || opening < 0) return setError('Opening quantity must be a whole number');
    const buy = buyResult.ngwee;
    const sell = sellResult.ngwee;
    // The first two axes fill the legacy size/colour slots that sync and USSD read.
    const [first, second] = profile.axes.map((axis) => attributes[axis.key]?.trim() || undefined);

    setSaving(true);
    try {
      const result = await createProduct(db, {
        name,
        category: category.trim() || undefined,
        // A shop without barcodes never stores one, even if a code was carried in.
        barcode: usesBarcodes ? barcode.trim() || undefined : undefined,
        buyPrice: buy,
        sellPrice: sell,
        openingQuantity: opening,
        lowStockLevel: Number.parseInt(lowStock, 10) || shop?.lowStockDefault,
        size: first,
        colour: second,
      });
      if (onboarding) {
        // Return to the setup screen that opened this form, dismissing any
        // intermediate scan/form screens and refreshing its product count.
        router.dismissTo('/onboarding/first-products');
      } else {
        router.replace(`/product/${result.productId}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the product');
    } finally {
      setSaving(false);
    }
  }

  async function handleShareLabel() {
    if (!labelRef.current) return;
    setError(null);
    try {
      const uri = await captureRef(labelRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: t('products.shareLabel'),
        });
        setMessage(t('products.labelShared'));
      } else {
        setError('Sharing is not available on this device');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share the label');
    }
  }

  async function handlePrintLabel() {
    if (!scannable) return;
    setError(null);
    const printPrice = parsePrice(sellPrice);
    const priceText = printPrice.ok ? formatKwacha(printPrice.ngwee) : '';
    try {
      await Print.printAsync({
        html: labelHtml({
          shopName: shop?.name ?? 'StockSure',
          productName: name.trim() || 'New product',
          priceText,
          code: savedCode,
        }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open printing');
    }
  }

  return (
    <Screen back
      title={t('product.new.title')}
      footer={<Button label={t('products.saveProduct')} disabled={saving} loading={saving} onPress={handleSave} />}
    >
      {usesBarcodes ? (
        <Button
          label={t('products.scanBarcode')}
          variant="secondary"
          onPress={() =>
            router.push(from ? { pathname: '/scan', params: { from } } : '/scan')
          }
        />
      ) : null}

      <SectionTitle>{t('product.new.details')}</SectionTitle>
      <Card>
        <Field label={t('product.new.name')} value={name} onChangeText={setName} placeholder={t('product.new.namePlaceholder')} required />
        <View style={styles.chips}>
          {profile.categories.map((suggestion) => (
            <Choice
              key={suggestion}
              label={suggestion}
              selected={suggestion === category}
              onPress={() => setCategory((current) => (current === suggestion ? '' : suggestion))}
            />
          ))}
        </View>
        <Field
          label={t('product.new.category')}
          value={category}
          onChangeText={setCategory}
          placeholder={profile.categories[0] ?? t('product.new.categoryPlaceholder')}
        />
        {profile.axes.map((axis) => (
          <View key={axis.key} style={styles.axis}>
            <Field
              label={t(axis.labelKey)}
              value={attributes[axis.key] ?? ''}
              onChangeText={(value) => setAttributes((current) => ({ ...current, [axis.key]: value }))}
              placeholder={axis.placeholder}
              maxLength={axis.maxLength}
            />
            <View style={styles.chips}>
              {axis.quickPicks.map((pick) => (
                <Choice
                  key={pick}
                  label={pick}
                  selected={attributes[axis.key] === pick}
                  onPress={() =>
                    setAttributes((current) => ({
                      ...current,
                      [axis.key]: current[axis.key] === pick ? '' : pick,
                    }))
                  }
                />
              ))}
            </View>
          </View>
        ))}
        {usesBarcodes ? (
          <Field
            label={t('product.new.barcode')}
            value={barcode}
            onChangeText={setBarcode}
            placeholder={t('products.barcodeAuto')}
            keyboardType="numeric"
          />
        ) : null}
      </Card>

      {usesBarcodes && barcode.trim() !== '' ? (
        <Card>
          {scannable ? (
            <>
              <BarcodeLabel code={savedCode} viewRef={labelRef} />
              <View style={styles.labelActions}>
                <View style={styles.rowButton}>
                  <Button label={t('products.shareLabel')} variant="secondary" onPress={handleShareLabel} />
                </View>
                <View style={styles.rowButton}>
                  <Button label={t('products.printLabel')} variant="secondary" onPress={handlePrintLabel} />
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.muted}>{t('products.notScannable')}</Text>
          )}
          {message ? <Text style={styles.success}>{message}</Text> : null}
        </Card>
      ) : null}

      <SectionTitle>{t('product.new.pricing')}</SectionTitle>
      <Card>
        <Field label={t('products.buyPrice')} value={buyPrice} onChangeText={(v) => setBuyPrice(sanitisePriceInput(v))} placeholder={t('product.new.buyPlaceholder')} keyboardType="decimal-pad" required />
        <Field label={t('products.sellPrice')} value={sellPrice} onChangeText={(v) => setSellPrice(sanitisePriceInput(v))} placeholder={t('product.new.sellPlaceholder')} keyboardType="decimal-pad" required />
        {lossPerUnit > 0 ? (
          <Text style={styles.warning}>{t('price.belowCost', { loss: formatKwacha(lossPerUnit) })}</Text>
        ) : profitPerUnit !== null ? (
          <Text style={styles.success} accessibilityLiveRegion="polite">
            {markupPercent !== null
              ? t('product.new.profit', { amount: formatKwacha(profitPerUnit), percent: markupPercent })
              : t('product.new.profitOnly', { amount: formatKwacha(profitPerUnit) })}
          </Text>
        ) : null}
      </Card>

      <SectionTitle>{t('products.inStock')}</SectionTitle>
      <Card>
        {profile.uniqueItems ? (
          <View style={styles.axis}>
            <Text style={styles.label}>{t('product.new.openingQty')}</Text>
            <Text style={styles.fixedValue}>{t('product.new.uniqueQty')}</Text>
          </View>
        ) : (
          <Field
            label={t('product.new.openingQty')}
            value={quantity}
            onChangeText={(v) => setQuantity(v.replace(/\D/g, ''))}
            placeholder={t('product.new.qtyPlaceholder')}
            hint={t('product.new.qtyHint')}
            keyboardType="numeric"
            required
          />
        )}
        <Field
          label={t('product.new.lowStock')}
          value={lowStock}
          onChangeText={(v) => setLowStock(v.replace(/\D/g, ''))}
          placeholder={t('product.new.lowStockPlaceholder', { count: shop?.lowStockDefault ?? 3 })}
          hint={t('product.new.lowStockHint')}
          keyboardType="numeric"
        />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  rowButton: { flex: 1 },
  axis: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  fixedValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  labelActions: { flexDirection: 'row', gap: spacing.md },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  warning: { fontSize: typeScale.label, color: colors.warning, fontWeight: '600' },
}));
