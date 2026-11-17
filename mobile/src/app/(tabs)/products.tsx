import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, EmptyState, Pill, Screen } from '@/components/ui';
import { lowStockItems, products, stockOnHand } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';

export default function ProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const alerts = lowStockItems();

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? products.filter((product) =>
        [product.name, product.category ?? '', ...product.variants.map((variant) => variant.barcode ?? '')]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : products;

  return (
    <Screen
      title={t('products.title')}
      footer={
        <View style={styles.footerRow}>
          <View style={styles.footerButton}>
            <Button label={t('products.addProduct')} onPress={() => router.push('/product/new')} />
          </View>
          <View style={styles.footerButton}>
            <Button
              label={t('products.scanBarcode')}
              variant="secondary"
              onPress={() => router.push('/product/new')}
            />
          </View>
        </View>
      }
    >
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('products.searchPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        autoCorrect={false}
      />

      {visible.length === 0 ? (
        <EmptyState message={t('products.empty')} />
      ) : (
        visible.map((product) => {
          const quantity = product.variants.reduce((sum, variant) => sum + stockOnHand(variant.id), 0);
          const isLow = alerts.some((alert) => alert.label.startsWith(product.name));
          return (
            <Card key={product.id}>
              <View style={styles.headerRow}>
                <Text style={styles.name}>{product.name}</Text>
                <Pill
                  label={`${quantity} ${t('products.inStock')}`}
                  tone={quantity === 0 ? 'danger' : isLow ? 'warning' : 'success'}
                />
              </View>
              <Text style={styles.muted}>
                {t('products.buyPrice')} {formatKwacha(product.defaultBuyPrice)} ·{' '}
                {t('products.sellPrice')} {formatKwacha(product.defaultSellPrice)}
              </Text>
              {product.variants.length > 1 ? (
                <Text style={styles.muted}>
                  {t('products.variants')}:{' '}
                  {product.variants.map((variant) => variant.size ?? variant.colour).filter(Boolean).join(', ')}
                </Text>
              ) : null}
              <Button
                label={t('products.restock')}
                variant="secondary"
                onPress={() => router.push(`/product/${product.id}`)}
              />
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.body,
    color: colors.text,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  footerButton: { flex: 1 },
});
