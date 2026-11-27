import { useAuth } from '@/auth/session';
import type { AndroidSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  LoadingList,
  Pill,
  Screen,
  SectionTitle,
  StatTile,
  type Tone,
} from '@/components/ui';
import type { ReconcileStatus } from '@/core/types';
import { useDayTotals, useSales } from '@/db/hooks';
import type { SaleSummary } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha, formatTime, localDayKey } from '@/lib/format';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

const statusView: Record<ReconcileStatus, { key: string; tone: Tone; icon: AndroidSymbol }> = {
  matched: { key: 'sales.state.matched', tone: 'success', icon: 'check_circle' },
  sale_no_payment: { key: 'sales.state.saleNoPayment', tone: 'warning', icon: 'schedule' },
  payment_no_sale: { key: 'sales.state.paymentNoSale', tone: 'warning', icon: 'help' },
  unresolved: { key: 'sales.state.unresolved', tone: 'neutral', icon: 'receipt_long' },
};

const METHOD_KEYS = {
  cash: 'sales.method.cash',
  mobile_money: 'sales.method.mobileMoney',
  split: 'sales.method.split',
} as const;

/** Newest first, split by local day so older sales never sit under "Today". */
function groupByDay(sales: SaleSummary[]): { day: string; sales: SaleSummary[] }[] {
  const groups: { day: string; sales: SaleSummary[] }[] = [];
  for (const sale of sales) {
    const day = localDayKey(sale.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.sales.push(sale);
    else groups.push({ day, sales: [sale] });
  }
  return groups;
}

// One row per sale: amount, time and who, and whether the money was found.
// The whole row opens the sale; cost and discount breakdowns live there.
export default function SalesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: totals, initialLoading: totalsLoading } = useDayTotals();
  const { data: sales, initialLoading, error, reload } = useSales();
  const { can } = useAuth();
  const canRecord = can('sales.record');
  const recordSale = () => router.push('/sale/new');
  const now = new Date();
  const today = localDayKey(now.toISOString());
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString());
  const dayLabel = (day: string) =>
    day === today ? t('common.today') : day === yesterday ? t('common.yesterday') : formatDay(day);

  if (initialLoading || totalsLoading || error) {
    return (
      <Screen back title={t('sales.title')} subtitle={t('common.today')}>
        {error ? (
          <ErrorState
            title={t('state.error.title')}
            message={t('state.error.message')}
            detail={error}
            retryLabel={t('common.retry')}
            onRetry={reload}
          />
        ) : (
          <LoadingList label={t('state.loading')} hero count={3} />
        )}
      </Screen>
    );
  }

  if (sales.length === 0) {
    return (
      <Screen back title={t('sales.title')} subtitle={t('common.today')}>
        <EmptyState
          icon="receipt_long"
          title={t('sales.empty.title')}
          message={t(canRecord ? 'sales.empty.message' : 'sales.empty.ownerMessage')}
          action={canRecord ? { label: t('sales.new'), icon: 'add', onPress: recordSale } : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('sales.title')}
      subtitle={t('common.today')}
      footer={canRecord ? <Button label={t('sales.new')} icon="add" onPress={recordSale} /> : undefined}
    >
      <View style={styles.stats}>
        <StatTile value={formatKwacha(totals.salesTotal)} label={t('sales.todayTotal')} icon="payments" />
        <StatTile value={totals.saleCount} label={t('home.today.count')} icon="receipt_long" />
      </View>

      <SectionTitle>{t('sales.items')}</SectionTitle>

      {groupByDay(sales).map((group) => (
        <View key={group.day} style={styles.day}>
          <Text style={styles.dayLabel} accessibilityRole="header">
            {dayLabel(group.day)}
          </Text>
          <ListGroup>
            {group.sales.map((sale, index) => {
              const voided = sale.status === 'void';
              // A cash-only sale is checked by the day's cash count, not by
              // payment messages, so "not matched yet" would mislead.
              const cashOnly = sale.paymentMethod === 'cash' && sale.reconcileStatus === 'unresolved';
              const status = statusView[sale.reconcileStatus as ReconcileStatus] ?? statusView.unresolved;
              const label = voided ? t('sales.voided') : cashOnly ? t('sales.state.cash') : t(status.key);
              const tone: Tone = voided ? 'danger' : cashOnly ? 'neutral' : status.tone;
              const when = formatTime(sale.createdAt);
              const method = sale.paymentMethod ? t(METHOD_KEYS[sale.paymentMethod]) : null;
              const meta = [when, method, sale.recordedByName].filter(Boolean).join(' · ');
              return (
                <ListRow
                  key={sale.id}
                  last={index === group.sales.length - 1}
                  icon={voided ? 'block' : cashOnly ? 'payments' : status.icon}
                  iconTone={tone}
                  title={formatKwacha(sale.total)}
                  meta={meta}
                  right={<Pill label={label} tone={tone} />}
                  accessibilityLabel={`${dayLabel(group.day)} ${when}, ${formatKwacha(sale.total)}, ${method ?? ''}, ${label}`}
                  onPress={() => router.push(`/sale/${sale.id}`)}
                />
              );
            })}
          </ListGroup>
        </View>
      ))}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.sm },
  day: { gap: spacing.xs },
  dayLabel: { fontSize: typeScale.label, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xs },
}));
