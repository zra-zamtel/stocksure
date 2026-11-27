import type { AndroidSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

export type JarState = 'short' | 'covered' | 'over';

/** How full the jar is, 0 to 1. An empty estimate with money aside reads as full. */
export function jarFill(saved: number, owed: number): number {
  if (owed <= 0) return saved > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, saved / owed));
}

/**
 * The money put aside for tax, drawn as a jar that fills toward what is owed.
 * Its state is said three ways (fill, icon, words), so it reads without
 * colour and without reading the amounts.
 */
export function TaxJar({ saved, owed, state }: { saved: number; owed: number; state: JarState }) {
  const { t } = useI18n();
  const fill = jarFill(saved, owed);
  const look: { icon: AndroidSymbol; color: string; text: string } =
    state === 'covered'
      ? { icon: 'check_circle', color: colors.success, text: t('tax.jar.covered') }
      : state === 'over'
        ? { icon: 'info', color: colors.primaryInk, text: t('tax.jar.over', { amount: formatKwacha(saved - owed) }) }
        : { icon: 'warning', color: colors.warning, text: t('tax.jar.short', { amount: formatKwacha(owed - saved) }) };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${t('tax.jar.label', { saved: formatKwacha(saved), owed: formatKwacha(owed) })}. ${look.text}`}
    >
      <View style={styles.jar}>
        <View style={styles.lid} />
        <View style={styles.glass}>
          <View style={[styles.fill, { height: `${Math.round(fill * 100)}%` }]} />
          <View style={styles.coin}>
            <Icon name="savings" size={iconSize.xl} color={fill > 0.45 ? colors.primaryText : colors.primaryInk} />
          </View>
        </View>
      </View>
      <View style={styles.text}>
        <Text style={styles.saved}>{formatKwacha(saved)}</Text>
        <Text style={styles.of}>{t('tax.jar.of', { owed: formatKwacha(owed) })}</Text>
        <View style={styles.state}>
          <Icon name={look.icon} size={iconSize.lg} color={look.color} />
          <Text style={[styles.stateText, { color: look.color }]}>{look.text}</Text>
        </View>
      </View>
    </View>
  );
}

const JAR_WIDTH = touch.big + spacing.xl;
const JAR_HEIGHT = touch.big * 2;

const styles = themed(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    jar: { alignItems: 'center' },
    lid: {
      width: JAR_WIDTH - spacing.md,
      height: spacing.sm,
      borderTopLeftRadius: radii.sm,
      borderTopRightRadius: radii.sm,
      backgroundColor: colors.border,
    },
    glass: {
      width: JAR_WIDTH,
      height: JAR_HEIGHT,
      borderRadius: radii.lg,
      borderWidth: spacing.xxs,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    fill: { width: '100%', backgroundColor: colors.primary },
    coin: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1, gap: spacing.xs },
    saved: { fontFamily: fonts.display, fontSize: typeScale.display, color: colors.text, fontVariant: ['tabular-nums'] },
    of: { fontSize: typeScale.body, color: colors.textMuted },
    state: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    stateText: { flex: 1, fontSize: typeScale.body, fontWeight: '700' },
  })
);
