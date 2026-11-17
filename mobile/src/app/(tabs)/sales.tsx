import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { useDayTotals, useSales } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

function statusTone(status: string) {
  if (status === 'matched') return 'success' as const;
  if (status === 'unresolved') return 'neutral' as const;
  return 'warning' as const;
}

export default function SalesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: totals } = useDayTotals();
  const { data: sales, loading, error } = useSales();

  return (
    <Screen
      title={t('sales.title')}
      subtitle={t('common.today')}
      footer={<Button label={t('sales.new')} onPress={() => router.push('/sale/new')} />}
    >
      <Card>
        <Row label={t('sales.total')} value={formatKwacha(totals.salesTotal)} emphasis />
        <Row label={t('sales.summary.cost')} value={formatKwacha(totals.cost)} />
        <Row label={t('sales.summary.discounts')} value={formatKwacha(totals.discounts)} />
        <Row label={t('home.today.profit')} value={formatKwacha(totals.grossProfit)} />
      </Card>

      <SectionTitle>{t('sales.items')}</SectionTitle>
      {error ? <EmptyState message={error} /> : null}
      {!loading && !error && sales.length === 0 ? <EmptyState message={t('sales.empty')} /> : null}

      {sales.map((sale) => (
        <Card key={sale.id}>
          <View style={styles.row}>
            <Text style={styles.time}>{sale.createdAt.slice(11, 16)}</Text>
            <View style={styles.right}>
              <Text style={styles.amount}>{formatKwacha(sale.total)}</Text>
              {sale.status === 'void' ? <Pill label={t('sales.voided')} tone="danger" /> : null}
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>{t('sales.status')}</Text>
            <Pill label={sale.reconcileStatus} tone={statusTone(sale.reconcileStatus)} />
          </View>
          <Button label={t('sales.void')} variant="secondary" onPress={() => router.push(`/sale/${sale.id}`)} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  time: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  amount: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
