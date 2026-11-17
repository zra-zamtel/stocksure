import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import {
  lowStockItems,
  reconciliation,
  shop,
  taxEstimate,
  taxPeriod,
  todayTotals,
} from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatCount, formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const totals = todayTotals();
  const alerts = lowStockItems();
  const tax = taxEstimate();

  return (
    <Screen
      title={shop.name}
      subtitle={t('common.today')}
      footer={
        <View style={styles.footerRow}>
          <View style={styles.footerButton}>
            <Button label={t('home.actions.recordSale')} onPress={() => router.push('/sale/new')} />
          </View>
          <Link href="/settings" asChild>
            <Pressable accessibilityRole="button" style={styles.iconButton}>
              <Text style={styles.settingsLink}>{t('nav.settings')}</Text>
            </Pressable>
          </Link>
        </View>
      }
    >
      <Card>
        <Text style={styles.cardTitle}>{t('home.today.title')}</Text>
        <Row label={t('home.today.sales')} value={formatKwacha(totals.salesTotal)} emphasis />
        <Row label={t('home.today.count')} value={formatCount(totals.count)} />
        <Row label={t('home.today.profit')} value={formatKwacha(totals.grossProfit)} />
        <Row label={t('home.today.discounts')} value={formatKwacha(totals.discounts)} />
      </Card>

      <SectionTitle>{t('home.alerts.title')}</SectionTitle>
      <Card>
        {alerts.length === 0 ? (
          <Text style={styles.muted}>{t('home.alerts.empty')}</Text>
        ) : (
          alerts.map((item) => (
            <View key={item.variantId} style={styles.alertRow}>
              <View style={styles.alertText}>
                <Text style={styles.itemName}>{item.label}</Text>
                <Text style={styles.muted}>
                  {item.quantity} · {t('products.inStock')}
                </Text>
              </View>
              <Pill
                label={item.quantity === 0 ? t('home.alerts.out') : t('home.alerts.low')}
                tone={item.quantity === 0 ? 'danger' : 'warning'}
              />
            </View>
          ))
        )}
      </Card>

      <SectionTitle>{t('home.actions.title')}</SectionTitle>
      <View style={styles.actionRow}>
        <View style={styles.actionButton}>
          <Button label={t('home.actions.addProduct')} variant="secondary" onPress={() => router.push('/product/new')} />
        </View>
        <View style={styles.actionButton}>
          <Button label={t('home.actions.scanBarcode')} variant="secondary" onPress={() => router.push('/product/new')} />
        </View>
      </View>

      <SectionTitle>{t('home.reconcile.title')}</SectionTitle>
      <Card>
        <Row label={t('home.reconcile.matched')} value={formatCount(reconciliation.matchedCount)} />
        <Row label={t('home.reconcile.unmatchedSales')} value={formatCount(reconciliation.saleNoPaymentCount)} />
        <Row label={t('home.reconcile.unmatchedPayments')} value={formatCount(reconciliation.paymentNoSaleCount)} />
        <Row
          label={t('home.reconcile.cashVariance')}
          value={reconciliation.countedCash === undefined ? t('common.notYet') : formatKwacha(0)}
        />
      </Card>

      <SectionTitle>{t('home.tax.title')}</SectionTitle>
      <Card>
        <Row label={t('home.tax.estimate')} value={formatKwacha(tax.estimatedTax)} emphasis />
        <Row label={t('home.tax.pot')} value={formatKwacha(tax.potBalance)} />
        <Row label={t('home.tax.due')} value={taxPeriod.dueOn} />
      </Card>

      <SectionTitle>{t('home.sync.title')}</SectionTitle>
      <Card>
        <View style={styles.syncRow}>
          <Pill label={t('common.offline')} tone="warning" />
          <Text style={styles.muted}>
            {t('sync.lastSync')}: {t('sync.never')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  alertRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  alertText: { flexShrink: 1, gap: 2 },
  itemName: { fontSize: typeScale.body, color: colors.text, fontWeight: '500' },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionButton: { flex: 1 },
  footerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  footerButton: { flex: 1 },
  iconButton: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
  settingsLink: { fontSize: typeScale.label, color: colors.primary, fontWeight: '700' },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
