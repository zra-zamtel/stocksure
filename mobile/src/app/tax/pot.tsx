import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Field, LoadingList, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { estimateTurnoverTax, potStatus, toNgwee } from '@/core';
import { useTaxPot } from '@/db/hooks';
import { payTaxPot, topUpTaxPot } from '@/db/repos';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

export default function TaxPotScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useTaxPot();

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const estimate = estimateTurnoverTax(data.turnover, taxRules, data.yearToDate);
  const pot = potStatus(estimate.estimatedTax, data.potBalance);
  const period = data.period;
  const shortfall = Math.max(0, estimate.estimatedTax - data.potBalance);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !period) {
    return (
      <Screen back title={t('tax.pot.title')}>
        <LoadingList label={t('state.loading')} hero count={2} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen back title={t('tax.pot.title')}>
        <ErrorState
          title={t('state.error.title')}
          message={t('state.error.message')}
          detail={error}
          retryLabel={t('common.retry')}
          onRetry={reload}
        />
      </Screen>
    );
  }

  if (!period) {
    return (
      <Screen back title={t('tax.pot.title')}>
        <EmptyState message={t('common.notYet')} />
      </Screen>
    );
  }

  const typed = Number.parseFloat(amount.replace(',', '.'));
  const amountToSetAside = Number.isFinite(typed) ? toNgwee(typed) : shortfall;

  return (
    <Screen back title={t('tax.pot.title')} subtitle={`${formatDay(period.startsOn)} – ${formatDay(period.endsOn)}`}>
      <Card>
        <Row label={t('tax.estimate')} value={formatKwacha(estimate.estimatedTax)} />
        <Row label={t('tax.pot.balance')} value={formatKwacha(data.potBalance)} emphasis />
        <Pill
          label={
            pot.state === 'short'
              ? `${t('tax.pot.short')} ${formatKwacha(shortfall)}`
              : pot.state === 'over'
                ? t('tax.pot.over')
                : t('tax.pot.covered')
          }
          tone={pot.state === 'short' ? 'warning' : pot.state === 'over' ? 'info' : 'success'}
        />
      </Card>

      <SectionTitle>{t('tax.pot.topUp')}</SectionTitle>
      <Card>
        <Field
          label={t('tax.pot.amount')}
          value={amount}
          onChangeText={setAmount}
          placeholder={(shortfall / 100).toFixed(2)}
          keyboardType="decimal-pad"
        />
        <Text style={styles.muted}>
          {amount.trim() === '' ? t('tax.pot.suggested') : t('tax.pot.willSetAside')}{' '}
          {formatKwacha(amountToSetAside)}
        </Text>
        <Button
          label={t('tax.pot.topUp')}
          disabled={busy || amountToSetAside <= 0}
          onPress={() =>
            perform(async () => {
              await topUpTaxPot(db, period.id, amountToSetAside);
              setMessage(t('tax.pot.topUpDone', { amount: formatKwacha(amountToSetAside) }));
              setAmount('');
            })
          }
        />
      </Card>

      <SectionTitle>{t('tax.pot.payZra')}</SectionTitle>
      <Card>
        <Button
          label={t('tax.pot.payZra')}
          variant="danger"
          disabled={busy || data.potBalance <= 0}
          onPress={() =>
            perform(async () => {
              const result = await payTaxPot(db, period.id);
              setMessage(t('tax.pot.paidBody', { amount: formatKwacha(result.amount) }));
            })
          }
        />
        <Text style={styles.disclaimer}>{t('tax.pot.noMoneyMoves')}</Text>
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </Card>

      <SectionTitle>{t('tax.pot.entries')}</SectionTitle>
      <Card>
        {data.entries.length === 0 ? (
          <EmptyState message={t('common.none')} />
        ) : (
          data.entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <Row
                label={`${t(`tax.pot.kind.${entry.kind}`)} · ${formatDay(entry.createdAt)}`}
                value={formatKwacha(entry.kind === 'paid' ? -entry.amount : entry.amount)}
              />
            </View>
          ))
        )}
      </Card>

      <Text style={styles.disclaimer}>
        Rules v{taxRules.version} · rate {(taxRules.rate * 100).toFixed(1)}% · reminders{' '}
        {taxRules.reminderDaysBefore.join(', ')} days before
      </Text>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  disclaimer: { fontSize: typeScale.caption, color: colors.textMuted, marginTop: spacing.xs },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  entry: { marginVertical: 0 },
}));
