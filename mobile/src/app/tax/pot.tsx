import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Notice } from '@/components/auth';
import { MoneyKeypad } from '@/components/money-keypad';
import { TaxJar } from '@/components/tax-jar';
import { Button, EmptyState, ErrorState, Icon, LoadingList, Screen, SectionTitle } from '@/components/ui';
import { estimateTurnoverTax, potStatus, toNgwee } from '@/core';
import { useTaxPot } from '@/db/hooks';
import { payTaxPot, topUpTaxPot } from '@/db/repos';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import { useFlash } from '@/lib/use-flash';
import { colors, fonts, iconSize, spacing, themed, touch, typeScale } from '@/theme/tokens';

/**
 * The tax jar, a keypad pre-filled with what is missing, one big button to put
 * it aside, and (after asking first) one to record a payment to ZRA.
 */
export default function TaxPotScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useTaxPot();

  // null means "show the suggestion"; the owner's typing replaces it.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Done" notices fade on their own; errors stay until dealt with.
  const [message, setMessage] = useFlash();
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
        <EmptyState
          message={t('common.notYet')}
          action={{ label: t('common.back'), icon: 'arrow_back', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const suggestion = shortfall > 0 ? String(shortfall / 100) : '';
  const value = draft ?? suggestion;
  const typed = Number.parseFloat(value.replace(',', '.'));
  const amountToSetAside = Number.isFinite(typed) ? toNgwee(typed) : 0;

  function confirmPay() {
    Alert.alert(t('tax.pot.confirmPayTitle'), t('tax.pot.confirmPayBody', { amount: formatKwacha(data.potBalance) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tax.pot.confirmPay'),
        style: 'destructive',
        onPress: () =>
          void perform(async () => {
            const result = await payTaxPot(db, period!.id);
            setMessage(t('tax.pot.paidBody', { amount: formatKwacha(result.amount) }));
          }),
      },
    ]);
  }

  return (
    <Screen back title={t('tax.pot.title')} subtitle={`${formatDay(period.startsOn)} – ${formatDay(period.endsOn)}`}>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      <TaxJar saved={data.potBalance} owed={estimate.estimatedTax} state={pot.state} />

      <SectionTitle>{t('tax.pot.topUp')}</SectionTitle>
      <MoneyKeypad value={value} onChange={setDraft} label={t('tax.pot.amount')} disabled={busy} />
      <Button
        label={t('tax.pot.putAsideAmount', { amount: formatKwacha(amountToSetAside) })}
        icon="savings"
        disabled={busy || amountToSetAside <= 0}
        onPress={() =>
          void perform(async () => {
            await topUpTaxPot(db, period.id, amountToSetAside);
            setMessage(t('tax.pot.topUpDone', { amount: formatKwacha(amountToSetAside) }));
            setDraft(null);
          })
        }
      />

      <SectionTitle>{t('tax.pot.payZra')}</SectionTitle>
      <Text style={styles.caption}>{t('tax.pot.noMoneyMoves')}</Text>
      <Button
        label={t('tax.pot.payZra')}
        icon="account_balance"
        variant="danger"
        disabled={busy || data.potBalance <= 0}
        onPress={confirmPay}
      />

      {/* What went in and out of the pot, newest first as the repo returns it. */}
      {data.entries.length > 0 ? (
        <>
          <SectionTitle>{t('tax.pot.entries')}</SectionTitle>
          {data.entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <Icon
                name={entry.kind === 'paid' ? 'account_balance' : 'savings'}
                size={iconSize.lg}
                color={entry.kind === 'paid' ? colors.textMuted : colors.success}
              />
              <View style={styles.entryText}>
                <Text style={styles.entryKind}>{t(`tax.pot.kind.${entry.kind}`)}</Text>
                <Text style={styles.entryDate}>{formatDay(entry.createdAt)}</Text>
              </View>
              <Text style={styles.entryAmount}>
                {formatKwacha(entry.kind === 'paid' ? -entry.amount : entry.amount)}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  caption: { fontSize: typeScale.caption, color: colors.textMuted, marginBottom: spacing.xs },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touch.big },
  entryText: { flex: 1, gap: spacing.xxs },
  entryKind: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  entryDate: { fontSize: typeScale.label, color: colors.textMuted },
  entryAmount: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, fontVariant: ['tabular-nums'] },
}));
