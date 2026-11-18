import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { estimateTurnoverTax, potStatus } from '@/core';
import { useTaxSnapshot } from '@/db/hooks';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function TaxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: snapshot } = useTaxSnapshot();
  const estimate = estimateTurnoverTax(snapshot.turnover, taxRules, snapshot.yearToDate);
  const pot = potStatus(estimate.estimatedTax, snapshot.potBalance);
  const period = snapshot.period;

  return (
    <Screen
      title={t('tax.title')}
      subtitle={period ? `${period.startsOn} – ${period.endsOn}` : undefined}
    >
      <Card>
        <Row label={t('tax.turnover')} value={formatKwacha(estimate.turnover)} />
        <Row label={t('tax.rate')} value={`${(estimate.rate * 100).toFixed(1)}%`} />
        <Row label={t('tax.estimate')} value={formatKwacha(estimate.estimatedTax)} emphasis />
        <Row label={t('tax.due')} value={period?.dueOn ?? t('common.notYet')} />
        {estimate.incomeTax ? (
          <Text style={styles.disclaimer}>
            Sales this year have reached {formatKwacha(estimate.threshold)}. From this level
            income tax applies instead of turnover tax, so no turnover tax figure is shown.
            Speak to ZRA about income tax.
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { fontSize: typeScale.caption, color: colors.textMuted, marginTop: spacing.xs },
  warningCard: { backgroundColor: colors.warningSoft },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  warningText: { flex: 1, fontSize: typeScale.label, color: colors.warning, fontWeight: '600' },
});
