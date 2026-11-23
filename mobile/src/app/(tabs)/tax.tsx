import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SmartInvoicePanel } from '@/components/smart-invoice-panel';
import { Button, Card, HelpTip, LoadingList, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { estimateTurnoverTax, potStatus } from '@/core';
import { useTaxSnapshot } from '@/db/hooks';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { markVisited } from '@/lib/getting-started';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function TaxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: snapshot, initialLoading } = useTaxSnapshot();
  // Opening this tab ticks "See your tax estimate" on the Home start list.
  useFocusEffect(useCallback(() => markVisited('tax'), []));
  const estimate = estimateTurnoverTax(snapshot.turnover, taxRules, snapshot.yearToDate);
  const pot = potStatus(estimate.estimatedTax, snapshot.potBalance);
  const period = snapshot.period;

  if (initialLoading) {
    return (
      <Screen title={t('tax.title')}>
        <LoadingList label={t('state.loading')} hero count={1} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('tax.title')}
      subtitle={period ? `${period.startsOn} – ${period.endsOn}` : undefined}
    >
      {estimate.turnover === 0 ? <HelpTip icon="info">{t('tax.empty.tip')}</HelpTip> : null}

      <Card>
        <Row label={t('tax.turnover')} value={formatKwacha(estimate.turnover)} />
        <Row label={t('tax.rate')} value={`${(estimate.rate * 100).toFixed(1)}%`} />
        <Row label={t('tax.estimate')} value={formatKwacha(estimate.estimatedTax)} emphasis />
        <Row label={t('tax.due')} value={period?.dueOn ?? t('common.notYet')} />
        {estimate.incomeTax ? (
          <Text style={styles.disclaimer}>
            {t('tax.incomeTax', { amount: formatKwacha(estimate.threshold) })}
          </Text>
        ) : null}
        <Text style={styles.disclaimer}>{t('tax.warning')}</Text>
      </Card>

      {snapshot.unresolvedSales > 0 ? (
        <Card style={styles.warningCard}>
          <View style={styles.warningRow}>
            <Pill label="!" tone="warning" />
            <Text style={styles.warningText}>
              {t('tax.unreconciled')} ({snapshot.unresolvedSales})
            </Text>
          </View>
        </Card>
      ) : null}

      <SectionTitle>{t('tax.pot.title')}</SectionTitle>
      <Card>
        <Row label={t('tax.pot.balance')} value={formatKwacha(snapshot.potBalance)} emphasis />
        <Row
          label={
            pot.state === 'short'
              ? t('tax.pot.short')
              : pot.state === 'over'
                ? t('tax.pot.over')
                : t('tax.pot.covered')
          }
          value={formatKwacha(Math.abs(pot.difference))}
        />
        <Pill
          label={
            pot.state === 'short'
              ? t('tax.pot.short')
              : pot.state === 'over'
                ? t('tax.pot.over')
                : t('tax.pot.covered')
          }
          tone={pot.state === 'short' ? 'warning' : pot.state === 'over' ? 'info' : 'success'}
        />
        <Button label={t('tax.pot.topUp')} variant="secondary" onPress={() => router.push('/tax/pot')} />
        <Button label={t('tax.pot.payZra')} onPress={() => router.push('/tax/pot')} />
        <Text style={styles.disclaimer}>{t('tax.pot.simulated')}</Text>
      </Card>

      <SectionTitle>{t('si.title')}</SectionTitle>
      <SmartInvoicePanel compact />
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { fontSize: typeScale.caption, color: colors.textMuted, marginTop: spacing.xs },
  warningCard: { backgroundColor: colors.warningSoft },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  warningText: { flex: 1, fontSize: typeScale.label, color: colors.warning, fontWeight: '600' },
});
