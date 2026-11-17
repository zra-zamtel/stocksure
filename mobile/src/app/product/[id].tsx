import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Pill, Row, Screen } from '@/components/ui';
import { products, stockMovements, stockOnHand } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function ProductScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = products.find((candidate) => candidate.id === id);

  if (!product) {
    return (
      <Screen title={t('products.title')}>
        <EmptyState message="Product not found." />
      </Screen>
    );
  }

  return (
    <Screen
      title={product.name}
      subtitle={product.category}
      footer={<Button label={t('products.restock')} onPress={() => router.back()} />}
    >
      <Card>
        <Row label={t('products.buyPrice')} value={formatKwacha(product.defaultBuyPrice)} />
        <Row label={t('products.sellPrice')} value={formatKwacha(product.defaultSellPrice)} />
        <Row
          label={t('products.margin')}
          value={formatKwacha(product.defaultSellPrice - product.defaultBuyPrice)}
        />
      </Card>

      <Text style={styles.section}>{t('products.variants')}</Text>
      {product.variants.map((variant) => {
        const quantity = stockOnHand(variant.id);
        return (
          <Card key={variant.id}>
            <View style={styles.row}>
              <Text style={styles.name}>{[variant.size, variant.colour].filter(Boolean).join(' · ') || 'Single'}</Text>
              <Pill
                label={`${quantity}`}
                tone={quantity === 0 ? 'danger' : quantity <= variant.lowStockLevel ? 'warning' : 'success'}
              />
            </View>
            <Row label="Barcode" value={variant.barcode ?? t('common.notYet')} />
            <Row label={t('products.sellPrice')} value={formatKwacha(variant.sellPrice)} />
          </Card>
        );
      })}

      <Text style={styles.section}>{t('products.recentMovements')}</Text>
      {stockMovements
        .filter((movement) => product.variants.some((variant) => variant.id === movement.variantId))
        .map((movement) => (
          <Row
            key={movement.id}
            label={`${movement.reason} · ${movement.createdAt.slice(11, 16)}`}
            value={String(movement.quantityChange)}
          />
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  section: {
    fontSize: typeScale.label,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
