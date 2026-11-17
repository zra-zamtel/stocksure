import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { reconciliation, taxEstimate, taxPeriod, taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function TaxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { turnover, estimatedTax, potBalance } = taxEstimate();
  const shortfall = estimatedTax - potBalance;
  const unreconciled = reconciliation.saleNoPaymentCount + reconciliation.paymentNoSaleCount;

  return (
    <Screen title={t('tax.title')} subtitle={`${taxPeriod.startsOn} – ${taxPeriod.endsOn}`}>
      <Card>
        <Row label={t('tax.turnover')} value={formatKwacha(turnover)} />
        <Row label={t('tax.rate')} value={`${(taxRules.rate * 100).toFixed(1)}%`} />
        <Row label={t('tax.estimate')} value={formatKwacha(estimatedTax)} emphasis />
        <Row label={t('tax.due')} value={taxPeriod.dueOn} />
        <Text style={styles.disclaimer}>{t('tax.warning')}</Text>
      </Card>

      {unreconciled > 0 ? (
        <Card style={styles.warningCard}>
          <View style={styles.warningRow}>
            <Pill label="!" tone="warning" />
            <Text style={styles.warningText}>
              {t('tax.unreconciled')} ({unreconciled})
            </Text>
          </View>
        </Card>
      ) : null}

      <SectionTitle>{t('tax.pot.title')}</SectionTitle>
      <Card>
        <Row label={t('tax.pot.balance')} value={formatKwacha(potBalance)} emphasis />
        <Row
          label={shortfall > 0 ? t('tax.pot.short') : t('tax.pot.over')}
          value={formatKwacha(Math.abs(shortfall))}
        />
        <Pill label={shortfall > 0 ? t('tax.pot.short') : t('tax.pot.covered')} tone={shortfall > 0 ? 'warning' : 'success'} />
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
