// One product in the stock grid: a picture, the name, and one big number in a
// ring. State is shown by ring colour, an icon and a word, never colour alone.
import { StyleSheet, Text, View } from 'react-native';
import { PressScale, ProductTile } from '@/components/big-ui';
import { Icon } from '@/components/ui';
import type { ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

const RING = touch.big + spacing.sm;

export function StockCard({
  product,
  state,
  onPress,
}: {
  product: ProductWithStock;
  state: 'ok' | 'low' | 'out';
  onPress?: () => void;
}) {
  const { t } = useI18n();
  const stateColor = state === 'ok' ? colors.success : state === 'low' ? colors.warning : colors.danger;
  const stateIcon = state === 'ok' ? 'check_circle' : state === 'low' ? 'trending_down' : 'remove_shopping_cart';
  const stateWord = t(state === 'ok' ? 'stock.state.ok' : state === 'low' ? 'stock.state.low' : 'stock.state.out');

  const body = (
    <>
      <ProductTile
        id={product.id}
        name={product.name}
        category={product.category}
        photoUri={product.photoUri}
        size={touch.big + spacing.lg}
      />
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <View style={styles.stockRow}>
        <View style={[styles.ring, { borderColor: stateColor }]}>
          <Text style={styles.number} numberOfLines={1} adjustsFontSizeToFit>
            {product.stock}
          </Text>
        </View>
        <View style={styles.stateCol}>
          <Icon name={stateIcon} size={iconSize.lg} color={stateColor} />
          <Text style={styles.stateWord} numberOfLines={2}>
            {stateWord}
          </Text>
        </View>
      </View>
      {product.variants.length > 1 ? (
        <View style={styles.variants}>
          <Icon name="layers" size={iconSize.sm} color={colors.textMuted} />
          <Text style={styles.variantText}>{t('products.variantCount', { count: product.variants.length })}</Text>
        </View>
      ) : null}
    </>
  );

  const label = `${product.name}, ${product.stock}, ${stateWord}`;
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={styles.card}>
        {body}
      </View>
    );
  }
  return (
    <PressScale onPress={onPress} accessibilityLabel={label} accessibilityHint={t('stock.ask')} style={styles.card}>
      {body}
    </PressScale>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      flexBasis: '47%',
      flexGrow: 1,
      minHeight: touch.big * 3,
      padding: spacing.md,
      gap: spacing.sm,
      borderRadius: radii.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation.card,
    },
    name: { fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text },
    stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ring: {
      minWidth: RING,
      height: RING,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.pill,
      borderWidth: spacing.xxs + 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    number: {
      fontFamily: fonts.display,
      fontSize: typeScale.display,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    stateCol: { flex: 1, gap: spacing.xs },
    stateWord: { fontSize: typeScale.label, color: colors.textMuted },
    variants: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 'auto' },
    variantText: { fontSize: typeScale.label, color: colors.textMuted },
  })
);
