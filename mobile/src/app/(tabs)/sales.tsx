import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Icon, Pill, Screen, SectionTitle } from '@/components/ui';
import type { ReconcileStatus } from '@/core/types';
import { useDayTotals, useSales } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

const statusView: Record<ReconcileStatus, { key: string; tone: 'success' | 'warning' | 'neutral' }> = {
  matched: { key: 'sales.state.matched', tone: 'success' },
  sale_no_payment: { key: 'sales.state.saleNoPayment', tone: 'warning' },
  payment_no_sale: { key: 'sales.state.paymentNoSale', tone: 'warning' },
  unresolved: { key: 'sales.state.unresolved', tone: 'neutral' },
};

// One card per sale: time, amount, who, and whether the money was found. The
// whole card opens the sale, so there is no extra button per row. Cost and
// discount breakdowns live on the sale itself.
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
        <Text style={styles.heroLabel}>{t('sales.total')}</Text>
        <Text style={styles.heroValue}>{formatKwacha(totals.salesTotal)}</Text>
      </Card>

      <SectionTitle>{t('sales.items')}</SectionTitle>
      {error ? <EmptyState message={error} /> : null}
      {!loading && !error && sales.length === 0 ? <EmptyState message={t('sales.empty')} /> : null}

      {sales.map((sale) => {
        const status = statusView[sale.reconcileStatus as ReconcileStatus] ?? statusView.unresolved;
        return (
          <Pressable
            key={sale.id}
            accessibilityRole="button"
            accessibilityLabel={`${sale.createdAt.slice(11, 16)}, ${formatKwacha(sale.total)}, ${t(status.key)}`}
            onPress={() => router.push(`/sale/${sale.id}`)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card>
              <View style={styles.row}>
                <Text style={styles.amount}>{formatKwacha(sale.total)}</Text>
                <Icon name="chevron_right" color={colors.textMuted} />
              </View>
              <Text style={styles.muted}>
                {sale.createdAt.slice(11, 16)} · {sale.recordedByName}
              </Text>
              <View style={styles.pills}>
                {sale.status === 'void' ? (
                  <Pill label={t('sales.voided')} tone="danger" />
                ) : (
                  <Pill label={t(status.key)} tone={status.tone} />
                )}
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroLabel: { fontSize: typeScale.body, color: colors.textMuted, fontWeight: '600' },
  heroValue: {
    fontSize: typeScale.display,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  amount: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  pills: { flexDirection: 'row', gap: spacing.sm },
  pressed: { opacity: 0.6 },
});
