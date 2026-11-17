import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Pill, Row, Screen, SectionTitle, Stub } from '@/components/ui';
import { mobileMoneyTxns, reconciliation, salesData } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';

export default function ReconcileScreen() {
  const { t } = useI18n();
  const unmatchedSales = salesData.filter((sale) => sale.reconcileStatus === 'sale_no_payment');
  const matched = salesData.filter((sale) => sale.reconcileStatus === 'matched');
  const matchedRefs = new Set(matched.map((sale) => sale.id));
  const orphanPayments = mobileMoneyTxns.filter((txn) => txn.reference === 'ZAM-552103');

  return (
    <Screen title={t('reconcile.title')} subtitle={t('common.today')}>
      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.matched')}</Text>
          <Pill label={String(matched.length)} tone="success" />
        </View>
        <Text style={styles.muted}>{matchedRefs.size} payment(s) agree with the sales book.</Text>
      </Card>

      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.saleNoPayment')}</Text>
          <Pill label={String(unmatchedSales.length)} tone="warning" />
        </View>
        {unmatchedSales.map((sale) => (
          <Row key={sale.id} label={sale.createdAt.slice(11, 16)} value={formatKwacha(sale.total)} />
        ))}
        <Button label={t('reconcile.resolve')} variant="secondary" />
      </Card>

      <Card>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t('reconcile.paymentNoSale')}</Text>
          <Pill label={String(orphanPayments.length)} tone="warning" />
        </View>
        {orphanPayments.map((txn) => (
          <Row key={txn.id} label={`${txn.provider} · ${txn.sender ?? ''}`} value={formatKwacha(txn.amount)} />
        ))}
        <Button label={t('reconcile.resolve')} variant="secondary" />
      </Card>

      <SectionTitle>{t('reconcile.cash.title')}</SectionTitle>
      <Card>
        <Row label={t('reconcile.cash.openingFloat')} value={formatKwacha(reconciliation.openingFloat)} />
        <Row label={t('reconcile.cash.expected')} value={formatKwacha(reconciliation.expectedCash)} />
        <View style={styles.field}>
          <Text style={styles.muted}>{t('reconcile.cash.counted')}</Text>
          <TextInput
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.muted}>{t('reconcile.cash.note')}</Text>
          <TextInput placeholder={t('common.optional')} placeholderTextColor={colors.textMuted} style={styles.input} />
        </View>
        <Button label={t('reconcile.cash.save')} />
      </Card>

      <Stub note="Matching engine (#37) and message reader (#36) replace the static lists above." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  field: { gap: spacing.xs },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.body,
    color: colors.text,
  },
});
