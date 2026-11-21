import { useRouter, type Href } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName } from '@/components/auth';
import { Button, Card, Icon, IconButton, Pill, Screen, SectionTitle } from '@/components/ui';
import { useDayTotals, useLowStock, useShop } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, touch, typeScale } from '@/theme/tokens';

type Shortcut = { key: string; icon: AndroidSymbol; label: string; href: Href };

/**
 * Home answers "how is today going?", "where do I go next?" and "what do I
 * need to restock?". Recording a sale is the one primary button; everything
 * else is a shortcut tile.
 */
export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, can, signOut } = useAuth();
  const { data: totals } = useDayTotals();
  const { data: alerts } = useLowStock();
  const { data: shopRecord } = useShop();

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12 ? 'home.greeting.morning' : hour < 17 ? 'home.greeting.afternoon' : 'home.greeting.evening',
  );
  const firstName = user ? displayName(user.name).split(' ')[0] : '';

  const shortcuts: Shortcut[] = [
    ...(can('products.manage')
      ? [
          {
            key: 'add',
            icon: 'add_box' as AndroidSymbol,
            label: t('home.actions.addProduct'),
            href: '/product/new' as Href,
          },
        ]
      : []),
    {
      key: 'products',
      icon: 'inventory_2',
      label: t('nav.products'),
      href: '/(tabs)/products',
    },
    {
      key: 'sales',
      icon: 'receipt_long',
      label: t('home.actions.sales'),
      href: '/(tabs)/sales',
    },
    ...(can('money.insights')
      ? [
          {
            key: 'insights',
            icon: 'bar_chart' as AndroidSymbol,
            label: t('home.insights.title'),
            href: '/insights' as Href,
          },
        ]
      : []),
  ];

  const headerAction = can('settings.view') ? (
    <IconButton name="settings" label={t('nav.settings')} onPress={() => router.push('/settings')} />
  ) : (
    <IconButton name="logout" label={t('settings.signOut')} onPress={signOut} />
  );

  return (
    <Screen
      title={firstName ? `${greeting}, ${firstName}` : greeting}
      subtitle={shopRecord?.name ?? t('app.name')}
      action={headerAction}
      footer={<Button label={t('home.actions.recordSale')} onPress={() => router.push('/sale/new')} />}
    >
      <Card>
        <Text style={styles.heroLabel}>{t('home.today.salesToday')}</Text>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
          {formatKwacha(totals.salesTotal)}
        </Text>
        <Text style={styles.muted}>
          {t(totals.saleCount === 1 ? 'home.today.countOne' : 'home.today.countMany', {
            count: totals.saleCount,
          })}
        </Text>
      </Card>

      <View style={styles.grid}>
        {shortcuts.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <View style={styles.tileIcon}>
              <Icon name={item.icon} color={colors.primaryInk} />
            </View>
            <Text style={styles.tileLabel} numberOfLines={2}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle>{t('home.alerts.title')}</SectionTitle>
      {alerts.length === 0 ? (
        <View style={styles.allGood}>
          <Icon name="check_circle" size={20} color={colors.success} />
          <Text style={styles.muted}>{t('home.alerts.empty')}</Text>
        </View>
      ) : (
        <Card>
          {alerts.map((item) => {
            const out = item.quantity <= 0;
            return (
              <View key={item.variantId} style={styles.alertRow}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.label.replace(/\s+/g, ' ')}
                </Text>
                <View>
                  <Pill
                    label={out ? t('home.alerts.out') : t('home.alerts.left', { count: item.quantity })}
                    tone={out ? 'danger' : 'warning'}
                  />
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroLabel: {
    fontSize: typeScale.label,
    color: colors.textMuted,
    fontWeight: '600',
  },
  heroValue: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  grid: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: touch.minHeight * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tilePressed: { backgroundColor: colors.surfaceAlt },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: typeScale.label,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  allGood: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 40,
  },
  itemName: {
    flex: 1,
    fontSize: typeScale.body,
    color: colors.text,
    fontWeight: '600',
  },
});
