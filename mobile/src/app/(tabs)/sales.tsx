import { useAuth } from '@/auth/session';
import type { AndroidSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
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
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { spacing } from '@/theme/tokens';

const statusView: Record<ReconcileStatus, { key: string; tone: Tone; icon: AndroidSymbol }> = {
  matched: { key: 'sales.state.matched', tone: 'success', icon: 'check_circle' },
  sale_no_payment: { key: 'sales.state.saleNoPayment', tone: 'warning', icon: 'schedule' },
  payment_no_sale: { key: 'sales.state.paymentNoSale', tone: 'warning', icon: 'help' },
  unresolved: { key: 'sales.state.unresolved', tone: 'neutral', icon: 'receipt_long' },
};

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

  if (initialLoading || totalsLoading || error) {
    return (
      <Screen title={t('sales.title')} subtitle={t('common.today')}>
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
      <Screen title={t('sales.title')} subtitle={t('common.today')}>
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
      title={t('sales.title')}
      subtitle={t('common.today')}
      footer={canRecord ? <Button label={t('sales.new')} icon="add" onPress={recordSale} /> : undefined}
    >
      <View style={styles.stats}>
        <StatTile value={formatKwacha(totals.salesTotal)} label={t('sales.total')} icon="payments" />
        <StatTile value={totals.saleCount} label={t('home.today.count')} icon="receipt_long" />
      </View>

      <SectionTitle>{t('sales.items')}</SectionTitle>

      <ListGroup>
        {sales.map((sale, index) => {
          const voided = sale.status === 'void';
          const status = statusView[sale.reconcileStatus as ReconcileStatus] ?? statusView.unresolved;
          const when = sale.createdAt.slice(11, 16);
          return (
            <ListRow
              key={sale.id}
              last={index === sales.length - 1}
              icon={voided ? 'block' : status.icon}
              iconTone={voided ? 'danger' : status.tone}
              title={formatKwacha(sale.total)}
              meta={`${when} · ${sale.recordedByName}`}
              right={<Pill label={voided ? t('sales.voided') : t(status.key)} tone={voided ? 'danger' : status.tone} />}
              accessibilityLabel={`${when}, ${formatKwacha(sale.total)}, ${voided ? t('sales.voided') : t(status.key)}`}
              onPress={() => router.push(`/sale/${sale.id}`)}
            />
          );
        })}
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.sm },
});
