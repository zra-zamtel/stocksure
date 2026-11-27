import { useRouter, type Href } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName } from '@/components/auth';
import { ConnectReminder, SyncProblemBanner } from '@/components/connect-device';
import { GettingStarted } from '@/components/getting-started';
import { ProfileMenu } from '@/components/profile-menu';
import {
  Button,
  Icon,
  IconBadge,
  ListGroup,
  ListRow,
  Pill,
  Screen,
  SectionTitle,
  Skeleton,
  type Tone,
} from '@/components/ui';
import { profileForShop, todayLocal } from '@/core';
import { useDayTotals, useExpiring, useLowStock, useProducts, useShop } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

type Shortcut = { key: string; icon: AndroidSymbol; tone: Tone; label: string; href: Href };

/**
 * Home answers "how is today going?", "where do I go next?" and "what do I
 * need to restock?". Today's money sits on the one dark card so the eye lands
 * there first; recording a sale is the one primary button; everything else is
 * a shortcut tile.
 */
export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, can } = useAuth();
  const { data: totals, initialLoading: totalsLoading } = useDayTotals();
  const { data: alerts, initialLoading: alertsLoading } = useLowStock();
  const { data: products } = useProducts();
  const { data: shopRecord } = useShop();
  const { data: expiring } = useExpiring();
  const profile = profileForShop(shopRecord);
  const showsExpiry = profile.modules.includes('expiry');
  const today = todayLocal();
  const seesProfit = can('money.insights');

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12 ? 'home.greeting.morning' : hour < 17 ? 'home.greeting.afternoon' : 'home.greeting.evening',
  );
  const firstName = user ? displayName(user.name).split(' ')[0] : '';

  const shortcuts: Shortcut[] = [
    // The owner's main button is Add product, so no duplicate tile.
    ...(can('products.manage') && can('sales.record')
      ? [
          {
            key: 'add',
            icon: 'add_box' as AndroidSymbol,
            tone: 'primary' as Tone,
            label: t('home.actions.addProduct'),
            href: '/product/new' as Href,
          },
        ]
      : []),
    {
      key: 'products',
      icon: 'inventory_2',
      tone: 'primary',
      label: t('nav.products'),
      href: '/(tabs)/products',
    },
    {
      key: 'sales',
      icon: 'receipt_long',
      tone: 'primary',
      label: t('home.actions.sales'),
      href: '/(tabs)/sales',
    },
    ...(can('money.insights')
      ? [
          {
            key: 'insights',
            icon: 'bar_chart' as AndroidSymbol,
            tone: 'primary' as Tone,
            label: t('home.insights.title'),
            href: '/insights' as Href,
          },
        ]
      : []),
  ];

  return (
    <Screen
      title={firstName ? `${greeting}, ${firstName}` : greeting}
      subtitle={shopRecord?.name ?? t('app.name')}
      action={<ProfileMenu />}
      footer={
        can('sales.record') ? (
          <Button
            label={t('home.actions.recordSale')}
            icon="point_of_sale"
            onPress={() => router.push('/sale/new')}
          />
        ) : can('products.manage') ? (
          <Button label={t('home.actions.addProduct')} icon="add" onPress={() => router.push('/product/new')} />
        ) : undefined
      }
    >

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>{t('home.today.salesToday')}</Text>
          <Icon name="storefront" size={iconSize.md} color={colors.onInkMuted} />
        </View>
        {totalsLoading ? (
          <View style={styles.heroLoading} accessible accessibilityLabel={t('state.loading')}>
            <View style={styles.heroSkeleton} />
            <View style={[styles.heroSkeleton, styles.heroSkeletonSmall]} />
          </View>
        ) : (
          <>
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatKwacha(totals.salesTotal)}
            </Text>
            <View style={styles.heroFoot}>
              <View style={styles.heroStat}>
                <Icon name="receipt_long" size={iconSize.sm} color={colors.onInkMuted} />
                <Text style={styles.heroMeta}>
                  {t(totals.saleCount === 1 ? 'home.today.countOne' : 'home.today.countMany', {
                    count: totals.saleCount,
                  })}
                </Text>
              </View>
              {seesProfit ? (
                <View style={styles.heroStat}>
                  <Text style={styles.heroMeta}>{t('home.today.profit')}</Text>
                  <Text style={styles.heroProfit}>{formatKwacha(totals.grossProfit)}</Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>

      <ConnectReminder />
      <SyncProblemBanner />

      <GettingStarted />

      <View style={styles.grid}>
        {shortcuts.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => router.push(item.href)}
            android_ripple={{ color: colors.ripple }}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <IconBadge name={item.icon} tone={item.tone} size={44} />
            <Text style={styles.tileLabel} numberOfLines={2}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {showsExpiry && products.length > 0 ? (
        <>
          <SectionTitle>{t('home.expiring.title')}</SectionTitle>
          {expiring.length === 0 ? (
            <View style={styles.calm}>
              <IconBadge name="event_available" tone="success" size={36} />
              <Text style={[styles.allGoodText, styles.flexText]}>{t('home.expiring.empty')}</Text>
            </View>
          ) : (
            <ListGroup>
              {expiring.map((item, index) => {
                const expired = item.expiryDate < today;
                return (
                  <ListRow
                    key={item.variantId}
                    last={index === expiring.length - 1}
                    icon={expired ? 'event_busy' : 'event'}
                    iconTone={expired ? 'danger' : 'warning'}
                    title={item.label}
                    meta={t('home.expiring.left', { count: item.quantity })}
                    right={
                      <Pill
                        label={expired ? t('products.expired') : item.expiryDate}
                        tone={expired ? 'danger' : 'warning'}
                      />
                    }
                    onPress={can('products.manage') ? () => router.push(`/product/${item.productId}`) : undefined}
                  />
                );
              })}
            </ListGroup>
          )}
        </>
      ) : null}

      <SectionTitle
        action={alerts.length > 0 ? { label: t('nav.products'), onPress: () => router.push('/(tabs)/products') } : undefined}
      >
        {t('home.alerts.title')}
      </SectionTitle>
      {alertsLoading ? (
        <Skeleton height={56} radius={radii.lg} />
      ) : products.length === 0 ? (
        <View style={styles.calm}>
          <IconBadge name="inventory_2" tone="neutral" size={36} />
          <Text style={[styles.muted, styles.flexText]}>{t('home.alerts.noProducts')}</Text>
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.calm}>
          <IconBadge name="check_circle" tone="success" size={36} />
          <Text style={[styles.allGoodText, styles.flexText]}>{t('home.alerts.empty')}</Text>
        </View>
      ) : (
        <ListGroup>
          {alerts.map((item, index) => {
            const out = item.quantity <= 0;
            return (
              <ListRow
                key={item.variantId}
                last={index === alerts.length - 1}
                icon={out ? 'remove_shopping_cart' : 'trending_down'}
                iconTone={out ? 'danger' : 'warning'}
                title={item.label.replace(/\s+/g, ' ')}
                right={
                  <Pill
                    label={out ? t('home.alerts.out') : t('home.alerts.left', { count: item.quantity })}
                    tone={out ? 'danger' : 'warning'}
                  />
                }
                // Tapping goes straight to the product to restock it; the
                // row shows its chevron like every other list row.
                onPress={can('products.manage') ? () => router.push(`/product/${item.productId}`) : undefined}
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.xs,
    ...elevation.raised,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: {
    fontSize: typeScale.label,
    color: colors.onInkMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroValue: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -0.8,
    color: colors.onInk,
    fontVariant: ['tabular-nums'],
  },
  heroFoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroMeta: { fontSize: typeScale.label, color: colors.onInkMuted, fontWeight: '600' },
  heroProfit: {
    fontFamily: fonts.display,
    fontSize: typeScale.body,
    color: colors.successOnInk,
    fontVariant: ['tabular-nums'],
  },
  heroLoading: { gap: spacing.sm, paddingVertical: spacing.xs },
  heroSkeleton: { width: '55%', height: 40, borderRadius: radii.sm, backgroundColor: colors.inkLine },
  heroSkeletonSmall: { width: '35%', height: 14 },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  grid: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: touch.minHeight * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...elevation.card,
  },
  tilePressed: { backgroundColor: colors.surfaceAlt },
  tileLabel: {
    fontSize: typeScale.label,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  calm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  flexText: { flex: 1 },
  allGoodText: { fontSize: typeScale.body, color: colors.success, fontWeight: '700' },
}));
