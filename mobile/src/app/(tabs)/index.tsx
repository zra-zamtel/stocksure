import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Icon, IconButton, Pill, Screen, SectionTitle } from '@/components/ui';
import { useDayTotals, useLowStock, useShop } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

// Home answers two questions only: "how is today going?" and "what do I need
// to restock?". Profit, reconciliation and tax live on their own tabs so the
// first screen stays readable at a glance.
export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, can, signOut } = useAuth();
  const { data: totals } = useDayTotals();
  const { data: alerts } = useLowStock();
  const { data: shopRecord } = useShop();

  const headerAction = can('settings.view') ? (
    <IconButton name="settings" label={t('nav.settings')} onPress={() => router.push('/settings')} />
  ) : (
    <IconButton name="logout" label={t('settings.signOut')} onPress={signOut} />
  );

  return (
    <Screen
      title={shopRecord?.name ?? t('app.name')}
      subtitle={user ? `${t('common.today')} · ${user.name}` : t('common.today')}
      action={headerAction}
      footer={<Button label={t('home.actions.recordSale')} onPress={() => router.push('/sale/new')} />}
    >
      <Card>
        <Text style={styles.heroLabel}>{t('home.today.sales')}</Text>
        <Text style={styles.heroValue}>{formatKwacha(totals.salesTotal)}</Text>
        <Text style={styles.muted}>
          {t(totals.saleCount === 1 ? 'home.today.countOne' : 'home.today.countMany', {
            count: totals.saleCount,
          })}
        </Text>
      </Card>

      {can('money.insights') ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('home.insights.title')}. ${t('home.insights.body')}`}
          onPress={() => router.push('/insights')}
          style={({ pressed }) => [styles.insights, pressed && styles.pressed]}
        >
          <View style={styles.insightsIcon}>
            <Icon name="bar_chart" color={colors.primaryText} />
          </View>
          <View style={styles.insightsText}>
            <Text style={styles.itemName}>{t('home.insights.title')}</Text>
            <Text style={styles.muted}>{t('home.insights.body')}</Text>
          </View>
          <Icon name="chevron_right" color={colors.textMuted} />
        </Pressable>
      ) : null}

      <SectionTitle>{t('home.alerts.title')}</SectionTitle>
      <Card>
        {alerts.length === 0 ? (
          <Text style={styles.muted}>{t('home.alerts.empty')}</Text>
        ) : (
          alerts.map((item) => {
            const out = item.quantity <= 0;
            return (
              <View key={item.variantId} style={styles.alertRow}>
                <View style={styles.alertText}>
                  <Text style={styles.itemName}>{item.label.replace(/\s+/g, ' ')}</Text>
                  <Text style={styles.muted}>
                    {out ? t('home.alerts.none') : t('home.alerts.left', { count: item.quantity })}
                  </Text>
                </View>
                <Pill
                  label={out ? t('home.alerts.out') : t('home.alerts.low')}
                  tone={out ? 'danger' : 'warning'}
                />
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroLabel: { fontSize: typeScale.body, color: colors.textMuted, fontWeight: '600' },
  heroValue: {
    fontSize: typeScale.display,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  alertText: { flexShrink: 1, gap: 2 },
  insights: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  pressed: { opacity: 0.7 },
  insightsIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightsText: { flex: 1, gap: 2 },
  itemName: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
});
