import { StyleSheet, Text } from 'react-native';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { taxEstimate, taxPeriod, taxPot, taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function TaxPotScreen() {
  const { t } = useI18n();
  const { estimatedTax, potBalance } = taxEstimate();
  const shortfall = estimatedTax - potBalance;

  return (
    <Screen title={t('tax.pot.title')} subtitle={`${taxPeriod.startsOn} – ${taxPeriod.endsOn}`}>
      <Card>
        <Row label={t('tax.estimate')} value={formatKwacha(estimatedTax)} />
        <Row label={t('tax.pot.balance')} value={formatKwacha(potBalance)} emphasis />
        <Pill
          label={shortfall > 0 ? `${t('tax.pot.short')} ${formatKwacha(shortfall)}` : t('tax.pot.covered')}
          tone={shortfall > 0 ? 'warning' : 'success'}
        />
      </Card>

      <SectionTitle>{t('tax.pot.topUp')}</SectionTitle>
      <Button label={t('tax.pot.topUp')} variant="secondary" />
      <Button label={t('tax.pot.payZra')} />
      <Text style={styles.disclaimer}>{t('tax.pot.simulated')}</Text>

      <SectionTitle>{t('tax.rate')}</SectionTitle>
      <Card>
        {taxPot.map((entry) => (
          <Row
            key={entry.id}
            label={`${entry.kind} · ${entry.createdAt.slice(11, 16)}`}
            value={formatKwacha(entry.amount)}
          />
        ))}
        <Text style={styles.disclaimer}>
          Rules v{taxRules.version} · rate {(taxRules.rate * 100).toFixed(1)}% · reminders {taxRules.reminderDaysBefore.join(', ')} days before
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { fontSize: typeScale.caption, color: colors.textMuted, marginTop: spacing.xs },
});
