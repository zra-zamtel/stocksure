import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { useAuth } from '@/auth/session';
import { Button, Card, EmptyState, Field, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { useSaleDetail } from '@/db/hooks';
import { voidSale } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, typeScale } from '@/theme/tokens';

export default function SaleScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const { can } = useAuth();
  const guard = usePermissionGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: sale, loading, error, reload } = useSaleDetail(id);
  const seesMoney = can('money.insights');
  const canVoid = can('sales.void');

  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading && !sale) {
    return (
      <Screen title={t('sales.title')}>
        <Text style={styles.muted}>{t('common.syncing')}</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title={t('sales.title')}>
        <EmptyState message={error} />
      </Screen>
    );
  }

  if (!sale) {
    return (
      <Screen title={t('sales.title')}>
        <EmptyState message="Sale not found." />
      </Screen>
    );
  }

  async function handleVoid() {
    setSubmitError(null);
    try {
      guard('sales.void');
    } catch {
      setSubmitError(t('permission.denied'));
      return;
    }
    setSubmitting(true);
    try {
      await voidSale(db, sale!.id, reason.trim() || 'No reason given');
      setReason('');
      reload();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not void the sale');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title={`${t('sales.title')} · ${sale.createdAt.slice(11, 16)}`}
      subtitle={sale.createdAt.slice(0, 10)}
    >
      <Card>
        <View style={styles.statusRow}>
          <Text style={styles.muted}>{t('sales.status')}</Text>
          <Pill
            label={sale.status === 'void' ? t('sales.voided') : sale.reconcileStatus}
            tone={sale.status === 'void' ? 'danger' : sale.reconcileStatus === 'matched' ? 'success' : 'warning'}
          />
        </View>
        {seesMoney ? (
          <>
            <Row label={t('sale.new.subtotal')} value={formatKwacha(sale.subtotal)} />
            <Row label={t('sale.new.discounts')} value={formatKwacha(sale.discountTotal)} />
          </>
        ) : null}
        <Row label={t('sales.total')} value={formatKwacha(sale.total)} emphasis />
        <Row label={t('sale.recordedBy')} value={sale.recordedByName} />
        {sale.status === 'void' && sale.voidReason ? (
          <Text style={styles.muted}>
            {t('sales.voidReason')}: {sale.voidReason}
          </Text>
        ) : null}
      </Card>

      <SectionTitle>{t('sales.items')}</SectionTitle>
      <Card>
        {sale.lines.map((line) => (
          <Row
            key={line.id}
            label={`${line.label} × ${line.quantity}`}
            value={formatKwacha(line.finalPrice)}
          />
        ))}
      </Card>

      <SectionTitle>{t('sales.payment')}</SectionTitle>
      <Card>
        {sale.payments.map((payment) => (
          <Row
            key={payment.id}
            label={payment.provider ?? (payment.method === 'cash' ? t('sale.new.cash') : t('sale.new.mobileMoney'))}
            value={formatKwacha(payment.amount)}
          />
        ))}
        {sale.payments.length === 0 ? <EmptyState message={t('reconcile.saleNoPayment')} /> : null}
      </Card>

      {sale.status === 'active' && canVoid ? (
        <>
          <SectionTitle>{t('sales.void')}</SectionTitle>
          <Card>
            <Field
              label={t('sales.voidReason')}
              value={reason}
              onChangeText={setReason}
              placeholder={t('common.optional')}
            />
            <Button
              label={t('sales.void')}
              variant="danger"
              disabled={submitting}
              onPress={handleVoid}
            />
            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
            <Text style={styles.muted}>{t('tax.pot.simulated')}</Text>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
