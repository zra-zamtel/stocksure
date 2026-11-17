import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Pill, Row, Screen } from '@/components/ui';
import { paymentsData, products, saleLinesData, salesData } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

function describeVariant(variantId: string) {
  for (const product of products) {
    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (variant) return [product.name, variant.size, variant.colour].filter(Boolean).join(' · ');
  }
  return variantId;
}

export default function SaleScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sale = salesData.find((candidate) => candidate.id === id);

  if (!sale) {
    return (
      <Screen title={t('sales.title')}>
        <EmptyState message="Sale not found." />
      </Screen>
    );
  }

  const lines = saleLinesData.filter((line) => line.saleId === sale.id);
  const payments = paymentsData.filter((payment) => payment.saleId === sale.id);

  return (
    <Screen
      title={`${t('sales.title')} · ${sale.createdAt.slice(11, 16)}`}
      footer={<Button label={t('sales.void')} variant="danger" disabled />}
    >
      <Card>
        <Row label={t('sales.total')} value={formatKwacha(sale.total)} emphasis />
        <Row label={t('sales.summary.discounts')} value={formatKwacha(sale.discountTotal)} />
        <View style={styles.statusRow}>
          <Text style={styles.muted}>{t('sales.status')}</Text>
          <Pill label={sale.reconcileStatus} tone={sale.reconcileStatus === 'matched' ? 'success' : 'warning'} />
        </View>
      </Card>

      <Text style={styles.section}>{t('sales.items')}</Text>
      <Card>
        {lines.map((line) => (
          <Row
            key={line.id}
            label={`${describeVariant(line.variantId)} × ${line.quantity}`}
            value={formatKwacha(line.finalPrice)}
          />
        ))}
      </Card>

      <Text style={styles.section}>{t('sales.payment')}</Text>
      <Card>
        {payments.map((payment) => (
          <Row
            key={payment.id}
            label={payment.provider ?? t('sale.new.cash')}
            value={formatKwacha(payment.amount)}
          />
        ))}
        {payments.length === 0 ? <EmptyState message={t('reconcile.saleNoPayment')} /> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  section: {
    fontSize: typeScale.label,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
