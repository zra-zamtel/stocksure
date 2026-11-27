// One product (one variant) in the new-sale grid. Tap the tile to add one; the
// small minus takes one off. Everything the cashier needs is a picture, a big
// price and a number, so it still works for people who read little.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PressScale, ProductTile } from '@/components/big-ui';
import { Icon } from '@/components/ui';
import { formatKwacha } from '@/lib/format';
import { useI18n } from '@/i18n';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

export function PickTile({
  productId,
  productName,
  category,
  label,
  price,
  onHand,
  quantity,
  max,
  onAdd,
  onRemove,
}: {
  /** Product id: picks the stable tint of the picture. */
  productId: string;
  /** Product name: picks the category icon when category is missing. */
  productName: string;
  category?: string | null;
  /** What the cashier sees, e.g. "Castle Lager · Crate". */
  label: string;
  /** Sell price in ngwee (integer). */
  price: number;
  /** Stock on hand (may be 0 or negative). */
  onHand: number;
  /** How many of this are in the basket now. */
  quantity: number;
  /** The most this line may hold (the parent computes it). */
  max: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const out = onHand <= 0;
  const inBasket = quantity > 0;
  const stockText = out ? t('products.filter.out') : t('sale.new.stockLeft', { count: onHand });
  const a11yLabel =
    `${label}, ${formatKwacha(price)}, ${stockText}` + (inBasket ? `, ${t('sale.pick.inBasket', { count: quantity })}` : '');

  return (
    <PressScale
      onPress={onAdd}
      accessibilityLabel={a11yLabel}
      accessibilityHint={t('sale.pick.addHint')}
      // The minus button is merged into the tile for TalkBack, so offer it as an action.
      accessibilityActions={
        inBasket
          ? [
              { name: 'increment', label: t('sale.pick.addHint') },
              { name: 'decrement', label: t('sale.pick.removeOne') },
            ]
          : [{ name: 'increment', label: t('sale.pick.addHint') }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'decrement') onRemove();
        if (event.nativeEvent.actionName === 'increment') onAdd();
      }}
      style={[styles.tile, inBasket && styles.tileSelected, quantity >= max && styles.tileFull]}
    >
      <View style={styles.top}>
        <ProductTile id={productId} name={productName} category={category} size={touch.big + spacing.lg} />
        {inBasket ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{quantity}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.price}>{formatKwacha(price)}</Text>
      {/* Icon plus words: low stock must never rely on colour alone. */}
      <View style={styles.stockRow}>
        <Icon
          name={out ? 'remove_shopping_cart' : 'inventory_2'}
          size={iconSize.sm}
          color={out ? colors.danger : colors.textMuted}
        />
        <Text style={[styles.stockText, { color: out ? colors.danger : colors.textMuted }]}>{stockText}</Text>
      </View>
      {inBasket ? (
        <View style={styles.footer}>
          {/* Its own Pressable, so taking one off never also adds one. */}
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={t('sale.pick.removeOne')}
            android_ripple={{ color: colors.ripple }}
            style={styles.minus}
          >
            <Icon name="remove" size={iconSize.lg} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </PressScale>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      minHeight: touch.big * 3,
      padding: spacing.md,
      gap: spacing.xs,
      borderRadius: radii.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation.card,
    },
    // The selected border is thicker; the padding gives back the difference so
    // the picture and price stay exactly where they were.
    tileSelected: {
      borderWidth: 2,
      borderColor: colors.primary,
      padding: spacing.md - (2 - StyleSheet.hairlineWidth),
    },
    // Dimmed, not disabled: the parent explains why a tap added nothing.
    tileFull: { opacity: 0.6 },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    badge: {
      minWidth: touch.minHeight - spacing.sm,
      minHeight: touch.minHeight - spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontFamily: fonts.display,
      fontSize: typeScale.heading,
      color: colors.primaryText,
      fontVariant: ['tabular-nums'],
    },
    label: { fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text },
    price: {
      fontFamily: fonts.display,
      fontSize: typeScale.title,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    stockText: { fontSize: typeScale.label },
    footer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 'auto' },
    minus: {
      minWidth: touch.minHeight,
      minHeight: touch.minHeight,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
  })
);
