import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BarcodeLabel } from '@/components/barcode-label';
import { Button, Card, Field, Screen, SectionTitle } from '@/components/ui';
import { generateInStoreBarcode, isValidEan13, toNgwee } from '@/core';
import { useShop } from '@/db/hooks';
import { createProduct } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function NewProductScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { barcode: scannedBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const { data: shop } = useShop();

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
  const usesBarcodes = shop?.usesBarcodes ?? true;
  const scannable = barcode.trim() !== '' && isValidEan13(barcode.trim());

  async function handleSave() {
    setError(null);
    setMessage(null);

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
      router.replace(`/product/${result.productId}`);
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

  return (
    <Screen
      title={t('product.new.title')}
      footer={<Button label={t('products.saveProduct')} disabled={saving} onPress={handleSave} />}
    >
      {usesBarcodes ? (
        <View style={styles.row}>
          <View style={styles.rowButton}>
            <Button label={t('products.scanBarcode')} variant="secondary" onPress={() => router.push('/scan')} />
          </View>
          <View style={styles.rowButton}>
            <Button
              label={t('products.generateBarcode')}
              variant="secondary"
              onPress={() => {
                setBarcode(generateInStoreBarcode());
                setMessage(null);
              }}
            />
          </View>
        </View>
      ) : null}

      <SectionTitle>{t('product.new.name')}</SectionTitle>
      <Card>
        <Field label={t('product.new.name')} value={name} onChangeText={setName} placeholder="Black school shoes, size 42" required />
        <Field label={t('product.new.category')} value={category} onChangeText={setCategory} placeholder="Shoes" />
        <Field
          label={t('product.new.barcode')}
          value={barcode}
          onChangeText={setBarcode}
          placeholder={usesBarcodes ? t('products.generateBarcode') : t('common.optional')}
          keyboardType="numeric"
        />
      </Card>

      {barcode.trim() !== '' ? (
        <Card>
          {scannable ? (
            <>
              <BarcodeLabel code={barcode.trim()} viewRef={labelRef} />
              <Button label={t('products.shareLabel')} variant="secondary" onPress={handleShareLabel} />
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  rowButton: { flex: 1 },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
