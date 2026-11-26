import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { usePermissionGuard } from '@/auth/permissions';
import { BarcodeLabel } from '@/components/barcode-label';
import { Button, Card, Field, Screen, SectionTitle } from '@/components/ui';
import { isValidEan13, normaliseBarcode, toNgwee } from '@/core';
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

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [barcode, setBarcode] = useState(scannedBarcode ?? '');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lowStock, setLowStock] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const labelRef = useRef<ComponentRef<typeof View>>(null);
  const usesBarcodes = shop?.usesBarcodes ?? false;
  // Compare what will actually be saved: a 12-digit UPC-A is stored padded to EAN-13.
  const savedCode = barcode.trim() === '' ? '' : normaliseBarcode(barcode);
  const scannable = savedCode !== '' && isValidEan13(savedCode);

  async function handleSave() {
    setError(null);
    setMessage(null);

    try {
      guard('products.manage');
    } catch {
      setError(t('permission.denied'));
      return;
    }

    const buy = toNgwee(Number.parseFloat(buyPrice.replace(',', '.')));
    const sell = toNgwee(Number.parseFloat(sellPrice.replace(',', '.')));
    const opening = Number.parseInt(quantity, 10);

    if (!name.trim()) return setError('Product name is required');
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return setError('Buy and sell price are required');
    if (!Number.isInteger(opening) || opening < 0) return setError('Opening quantity must be a whole number');

    setSaving(true);
    try {
      const result = await createProduct(db, {
        name,
        category: category.trim() || undefined,
        barcode: barcode.trim() || undefined,
        buyPrice: buy,
        sellPrice: sell,
        openingQuantity: opening,
        lowStockLevel: Number.parseInt(lowStock, 10) || shop?.lowStockDefault,
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
    const priceValue = Number.parseFloat(sellPrice.replace(',', '.'));
    const priceText = Number.isFinite(priceValue) ? formatKwacha(toNgwee(priceValue)) : '';
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
    <Screen
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

      <SectionTitle>{t('product.new.name')}</SectionTitle>
      <Card>
        <Field label={t('product.new.name')} value={name} onChangeText={setName} placeholder="Black school shoes, size 42" required />
        <Field label={t('product.new.category')} value={category} onChangeText={setCategory} placeholder="Shoes" />
        <Field
          label={t('product.new.barcode')}
          value={barcode}
          onChangeText={setBarcode}
          placeholder={usesBarcodes ? t('products.barcodeAuto') : t('common.optional')}
          keyboardType="numeric"
        />
      </Card>

      {barcode.trim() !== '' ? (
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

      <SectionTitle>{t('products.buyPrice')}</SectionTitle>
      <Card>
        <Field label={t('products.buyPrice')} value={buyPrice} onChangeText={setBuyPrice} placeholder="180.00" keyboardType="decimal-pad" required />
        <Field label={t('products.sellPrice')} value={sellPrice} onChangeText={setSellPrice} placeholder="280.00" keyboardType="decimal-pad" required />
      </Card>

      <SectionTitle>{t('products.inStock')}</SectionTitle>
      <Card>
        <Field label={t('product.new.openingQty')} value={quantity} onChangeText={setQuantity} keyboardType="numeric" required />
        <Field
          label={t('product.new.lowStock')}
          value={lowStock}
          onChangeText={setLowStock}
          placeholder={String(shop?.lowStockDefault ?? 3)}
          keyboardType="numeric"
        />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  rowButton: { flex: 1 },
  labelActions: { flexDirection: 'row', gap: spacing.md },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
}));
