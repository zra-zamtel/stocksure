import { useRouter } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName } from '@/components/auth';
import { BackupStatusButton, useBackupState } from '@/components/backup-status';
import { BigTile, PressScale, ProductTile } from '@/components/big-ui';
import { SyncProblemBanner } from '@/components/connect-device';
import { ProfileMenu } from '@/components/profile-menu';
import { RestockSheet } from '@/components/stock/restock-sheet';
import { Button, Icon, IconBadge, Pill, Screen, Skeleton } from '@/components/ui';
import { profileForShop, todayLocal } from '@/core';
import { useDayTotals, useExpiring, useLowStock, useProducts, useShop } from '@/db/hooks';
import type { ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

type Tile = { key: string; icon: AndroidSymbol; label: string; onPress: () => void };

/**
 * Home answers one question: how is today going? The money sits on the one
 * dark card; under it, big picture tiles for what is not already in the bar
 * (Sell, Stock, Money and Tax are); then the single most urgent thing to do. Backup
 * and connect notices live behind the cloud in the header.
 */
export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, can } = useAuth();
  const { data: totals, initialLoading: totalsLoading } = useDayTotals();
  const { data: alerts, initialLoading: alertsLoading, reload: reloadAlerts } = useLowStock();
  const { data: products, initialLoading: productsLoading, reload: reloadProducts } = useProducts();
  // Restock happens right here in a sheet; nothing is saved until its Add button.
  const [restocking, setRestocking] = useState<{ product: ProductWithStock; variantId: string } | null>(null);
  const { data: shopRecord } = useShop();
  const { data: expiring } = useExpiring();
  const { expired: backupExpired } = useBackupState();
  const profile = profileForShop(shopRecord);
  const today = todayLocal();
  const seesProfit = can('money.insights');
  const managesProducts = can('products.manage');

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12 ? 'home.greeting.morning' : hour < 17 ? 'home.greeting.afternoon' : 'home.greeting.evening',
  );
  const firstName = user ? displayName(user.name).split(' ')[0] : '';

  const tiles: Tile[] = [
    ...(managesProducts && products.length > 0
      ? [{ key: 'add', icon: 'add_box' as AndroidSymbol, label: t('home.tiles.add'), onPress: () => router.push('/product/new') }]
      : []),
    { key: 'sales', icon: 'receipt_long', label: t('home.tiles.sales'), onPress: () => router.push('/(tabs)/sales') },
  ];

  // The one thing to act on now: something expired or expiring beats running low.
  const urgentExpiry = profile.modules.includes('expiry') ? expiring[0] : undefined;
  const urgentStock = alerts[0];
  const productById = new Map(products.map((product) => [product.id, product]));

  return (
    <Screen
      title={firstName ? `${greeting}, ${firstName}` : greeting}
      subtitle={shopRecord?.name ?? t('app.name')}
      action={
        <View style={styles.headerActions}>
          <BackupStatusButton />
          <ProfileMenu />
        </View>
      }
    >
      <PressScale
        onPress={() => router.push('/(tabs)/sales')}
        accessibilityLabel={[
          `${t('home.today.salesToday')}: ${formatKwacha(totals.salesTotal)}`,
          t(totals.saleCount === 1 ? 'home.today.countOne' : 'home.today.countMany', { count: totals.saleCount }),
          seesProfit ? `${t('home.today.profitShort')}: ${formatKwacha(totals.grossProfit)}` : null,
        ]
          .filter(Boolean)
          .join('. ')}
        accessibilityHint={t('home.today.seeSales')}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <Icon name="today" size={iconSize.lg} color={colors.onInkMuted} />
          <Text style={styles.heroLabel}>{t('home.today.title')}</Text>
          <Icon name="chevron_right" size={iconSize.lg} color={colors.onInkMuted} />
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
                <Icon name="receipt_long" size={iconSize.md} color={colors.onInkMuted} />
                <Text style={styles.heroMeta}>
                  {t(totals.saleCount === 1 ? 'home.today.countOne' : 'home.today.countMany', {
                    count: totals.saleCount,
                  })}
                </Text>
              </View>
              {seesProfit ? (
                <View style={styles.heroStat}>
                  <Icon name="trending_up" size={iconSize.md} color={colors.successOnInk} />
                  <Text style={styles.heroProfit}>{formatKwacha(totals.grossProfit)}</Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </PressScale>

      {/* Losing changes is the one backup problem too important to keep behind the cloud. */}
      {backupExpired ? <SyncProblemBanner /> : null}

      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <BigTile key={tile.key} icon={tile.icon} label={tile.label} onPress={tile.onPress} />
        ))}
      </View>

      {alertsLoading || productsLoading ? (
        <Skeleton height={touch.big * 2} radius={radii.xl} />
      ) : products.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <IconBadge name="inventory_2" tone="primary" size={touch.big} />
            <Text style={styles.cardText}>{t('home.alert.noProducts')}</Text>
          </View>
          {managesProducts ? (
            <Button label={t('home.tiles.add')} icon="add" onPress={() => router.push('/product/new')} />
          ) : null}
        </View>
      ) : urgentExpiry ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <ProductTile
              id={urgentExpiry.productId}
              name={urgentExpiry.label}
              category={productById.get(urgentExpiry.productId)?.category}
              photoUri={productById.get(urgentExpiry.productId)?.photoUri}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {urgentExpiry.label}
              </Text>
              {urgentExpiry.expiryDate < today ? (
                <StatusLine icon="event_busy" tone="danger" label={t('products.expired')} />
              ) : (
                <StatusLine icon="event" tone="warning" label={t('home.alert.expires', { date: formatDay(urgentExpiry.expiryDate) })} />
              )}
            </View>
          </View>
          {managesProducts ? (
            <Button
              label={t('home.alert.seeProduct')}
              icon={urgentExpiry.expiryDate < today ? 'event_busy' : 'event'}
              variant="secondary"
              onPress={() => router.push(`/product/${urgentExpiry.productId}`)}
            />
          ) : (
            <SeeStockButton filter="expiring" />
          )}
          {expiring.length > 1 ? <MoreLink count={expiring.length - 1} filter="expiring" /> : null}
        </View>
      ) : urgentStock ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <ProductTile
              id={urgentStock.productId}
              name={urgentStock.label}
              category={productById.get(urgentStock.productId)?.category}
              photoUri={productById.get(urgentStock.productId)?.photoUri}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {urgentStock.label}
              </Text>
              {urgentStock.quantity <= 0 ? (
                <StatusLine icon="remove_shopping_cart" tone="danger" label={t('home.alerts.out')} />
              ) : (
                <StatusLine icon="trending_down" tone="warning" label={t('home.alerts.left', { count: urgentStock.quantity })} />
              )}
            </View>
          </View>
          {managesProducts ? (
            <Button
              label={t('home.alert.restock')}
              icon="inventory"
              onPress={() => {
                const product = productById.get(urgentStock.productId);
                if (product) setRestocking({ product, variantId: urgentStock.variantId });
                else router.push(`/product/${urgentStock.productId}`);
              }}
            />
          ) : (
            <SeeStockButton filter={urgentStock.quantity <= 0 ? 'out' : 'low'} />
          )}
          {alerts.length > 1 ? <MoreLink count={alerts.length - 1} filter="low" /> : null}
        </View>
      ) : (
        <View style={[styles.card, styles.cardRow]}>
          <IconBadge name="check_circle" tone="success" size={touch.big} />
          <Text style={[styles.cardText, styles.allGood]}>{t('home.alert.allGood')}</Text>
        </View>
      )}

      <RestockSheet
        product={restocking?.product ?? null}
        initialVariantId={restocking?.variantId}
        onClose={() => setRestocking(null)}
        onSaved={() => {
          reloadAlerts();
          reloadProducts();
        }}
      />
    </Screen>
  );
}

/** A status pill with its icon beside it, so the state never rests on colour alone. */
function StatusLine({ icon, tone, label }: { icon: AndroidSymbol; tone: 'warning' | 'danger'; label: string }) {
  return (
    <View style={styles.status}>
      <Icon name={icon} size={iconSize.md} color={tone === 'danger' ? colors.danger : colors.warning} />
      <Pill label={label} tone={tone} />
    </View>
  );
}

type StockFilter = 'low' | 'out' | 'expiring';

/** Staff cannot restock, but the card still leads somewhere: the stock list, narrowed. */
function SeeStockButton({ filter }: { filter: StockFilter }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Button
      label={t('home.alert.seeStock')}
      icon="inventory_2"
      variant="secondary"
      onPress={() => router.push({ pathname: '/(tabs)/products', params: { filter } })}
    />
  );
}

/** "+N" with a stack picture: the rest of the list, opened on the same filter. */
function MoreLink({ count, filter }: { count: number; filter: StockFilter }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <PressScale
      onPress={() => router.push({ pathname: '/(tabs)/products', params: { filter } })}
      accessibilityLabel={t('home.alert.more', { count })}
      style={styles.more}
    >
      <Icon name="layers" size={iconSize.lg} color={colors.primaryInk} />
      <Text style={styles.moreText}>{t('home.alert.more', { count })}</Text>
      <Icon name="chevron_right" size={iconSize.md} color={colors.primaryInk} />
    </PressScale>
  );
}

const styles = themed(() => StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
    // The edge keeps the card distinct from the page in dark mode; overflow
    // keeps the press ripple inside the rounded corners.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkLine,
    overflow: 'hidden',
    ...elevation.raised,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLabel: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.onInkMuted },
  heroValue: {
    fontFamily: fonts.display,
    fontSize: typeScale.money,
    lineHeight: typeScale.money + 8,
    letterSpacing: -1,
    color: colors.onInk,
    fontVariant: ['tabular-nums'],
  },
  heroFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroMeta: { fontSize: typeScale.body, color: colors.onInkMuted, fontWeight: '600' },
  heroProfit: {
    fontFamily: fonts.display,
    fontSize: typeScale.heading,
    color: colors.successOnInk,
    fontVariant: ['tabular-nums'],
  },
  heroLoading: { gap: spacing.sm, paddingVertical: spacing.xs },
  heroSkeleton: { width: '60%', height: typeScale.money, borderRadius: radii.sm, backgroundColor: colors.inkLine },
  heroSkeletonSmall: { width: '35%', height: typeScale.body },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardBody: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  cardTitle: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
  cardText: { flex: 1, fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  allGood: { color: colors.success, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: touch.big,
    paddingHorizontal: spacing.xs,
  },
  moreText: { fontSize: typeScale.body, fontWeight: '700', color: colors.primaryInk },
}));
