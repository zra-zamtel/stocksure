import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Field, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { toNgwee } from '@/core';
import { useReconciliation } from '@/db/hooks';
import { ignorePayment, injectDemoMessages, markSalePaid, saveCashCount, voidSale } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function ReconcileScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useReconciliation();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countedDraft, setCountedDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const countedValue =
    countedDraft ??
    (data?.cash.countedCash !== undefined ? (data.cash.countedCash / 100).toFixed(2) : '');
  const noteValue = noteDraft ?? data?.cash.note ?? '';

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <Screen title={t('reconcile.title')}>
        <Text style={styles.muted}>{t('common.syncing')}</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title={t('reconcile.title')}>
        <EmptyState message={error} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen title={t('reconcile.title')}>
        <EmptyState message={t('reconcile.empty')} />
      </Screen>
    );
  }

  const cash = data.cash;

  return (
    <Screen title={t('reconcile.title')} subtitle={data.day}>
      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.matched')}</Text>
          <Pill label={String(data.matched.length)} tone="success" />
        </View>
        {data.matched.map((match) => (
          <Row
            key={`${match.saleId}-${match.txnId}`}
            label={match.reference ?? match.saleId}
            value={formatKwacha(match.amount)}
          />
        ))}
      </Card>

      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.saleNoPayment')}</Text>
          <Pill label={String(data.salesWithoutPayment.length)} tone="warning" />
        </View>
        {data.salesWithoutPayment.length === 0 ? (
          <Text style={styles.muted}>{t('reconcile.empty')}</Text>
        ) : (
          data.salesWithoutPayment.map((sale) => (
            <View key={sale.saleId} style={styles.item}>
              <Row
                label={`${sale.provider ?? t('sale.new.mobileMoney')} · ${sale.reference ?? t('common.notYet')}`}
                value={formatKwacha(sale.total)}
              />
              <View style={styles.actions}>
                <View style={styles.actionButton}>
                  <Button
                    label={t('reconcile.markPaid')}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => perform(() => markSalePaid(db, sale.saleId))}
                  />
                </View>
                <View style={styles.actionButton}>
                  <Button
                    label={t('sales.void')}
                    variant="danger"
                    disabled={busy}
                    onPress={() => perform(() => voidSale(db, sale.saleId, 'No payment received'))}
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.paymentNoSale')}</Text>
          <Pill label={String(data.paymentsWithoutSale.length)} tone="warning" />
        </View>
        {data.paymentsWithoutSale.length === 0 ? (
          <Text style={styles.muted}>{t('reconcile.empty')}</Text>
        ) : (
          data.paymentsWithoutSale.map((payment) => (
            <View key={payment.txnId} style={styles.item}>
              <Row
                label={`${payment.provider} · ${payment.sender ?? t('common.notYet')}`}
                value={formatKwacha(payment.amount)}
              />
              <Text style={styles.muted}>
                {payment.reference ?? t('common.notYet')} · {payment.receivedAt.slice(11, 16)}
              </Text>
              <Button
                label={t('reconcile.ignore')}
                variant="secondary"
                disabled={busy}
                onPress={() => perform(() => ignorePayment(db, payment.txnId))}
              />
            </View>
          ))
        )}
      </Card>

      <SectionTitle>{t('reconcile.cash.title')}</SectionTitle>
      <Card>
        <Row label={t('reconcile.cash.openingFloat')} value={formatKwacha(cash.openingFloat)} />
        <Row label={t('reconcile.cash.expected')} value={formatKwacha(cash.expected)} />
        <Field
          label={t('reconcile.cash.counted')}
          value={countedValue}
          onChangeText={setCountedDraft}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Field
          label={t('reconcile.cash.note')}
          value={noteValue}
          onChangeText={setNoteDraft}
          placeholder={t('common.optional')}
        />
        {cash.variance !== undefined ? (
          <Row
            label={t('reconcile.cash.variance')}
            value={formatKwacha(cash.variance)}
            emphasis
          />
        ) : null}
        <Button
          label={t('reconcile.cash.save')}
          disabled={busy || countedValue.trim() === ''}
          onPress={() => {
            const amount = toNgwee(Number.parseFloat(countedValue.replace(',', '.')) || 0);
            perform(async () => {
              await saveCashCount(db, data.day, amount, noteValue.trim() || undefined);
              setCountedDraft(null);
              setNoteDraft(null);
            }, t('reconcile.cashSaved'));
          }}
        />
      </Card>

      <SectionTitle>{t('common.today')}</SectionTitle>
      <Card>
        <Button
          label={t('reconcile.demo')}
          variant="secondary"
          disabled={busy}
          onPress={() => perform(() => injectDemoMessages(db, data.day), t('reconcile.demoAdded'))}
        />
        <Text style={styles.muted}>
          Real MTN, Airtel and Zamtel confirmation messages cannot be triggered on cue, so these are
          samples.
        </Text>
      </Card>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  item: { gap: spacing.xs, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1 },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
