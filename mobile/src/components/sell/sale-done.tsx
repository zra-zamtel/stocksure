// The full-screen "sale saved" view. It has to read with the words covered:
// a big tick, the amount, and two obvious buttons.
import type { AndroidSymbol } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, TextLink } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

type Method = 'cash' | 'mobile_money' | 'split';

const METHOD_ICON: Record<Method, AndroidSymbol> = {
  cash: 'payments',
  mobile_money: 'phone_iphone',
  split: 'call_split',
};

const DISC = touch.big * 2 + spacing.sm;

export function SaleDone({
  total,
  method,
  onNewSale,
  onDone,
  onReceipt,
}: {
  /** Sale total in ngwee. */
  total: number;
  method: Method;
  onNewSale: () => void;
  onDone: () => void;
  onReceipt: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  // Never starts from zero: 0.9 to 1 with a small bounce, a rare celebratory moment.
  const scale = useSharedValue(reduceMotion ? 1 : 0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 250 });
    if (!reduceMotion) scale.value = withSpring(1, { duration: 400, dampingRatio: 0.8 });
  }, [reduceMotion, opacity, scale]);

  const discStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const methodText =
    method === 'cash' ? t('sale.done.cash') : method === 'mobile_money' ? t('sale.done.mobile') : t('sale.done.split');
  const amount = formatKwacha(total);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.center}>
        <Animated.View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[styles.disc, discStyle]}
        >
          {/* onInverse: white on light success (about 5.4:1), near-black on dark success (about 10:1). */}
          <Icon name="check" size={iconSize.xl * 2} color={colors.onInverse} />
        </Animated.View>

        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${t('sale.done.title')}, ${amount}, ${methodText}`}
          style={styles.summary}
        >
          <Text style={styles.title}>{t('sale.done.title')}</Text>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
            {amount}
          </Text>
          <View style={styles.method}>
            <Icon name={METHOD_ICON[method]} size={iconSize.lg} color={colors.textMuted} />
            <Text style={styles.methodText}>{methodText}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label={t('sale.done.newSale')} icon="add_shopping_cart" onPress={onNewSale} />
        <Button label={t('sale.done.finish')} icon="home" variant="secondary" onPress={onDone} />
        <View style={styles.link}>
          <TextLink label={t('sale.done.receipt')} onPress={onReceipt} accent />
        </View>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
    disc: {
      width: DISC,
      height: DISC,
      borderRadius: radii.pill,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summary: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
    title: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text, textAlign: 'center' },
    amount: {
      alignSelf: 'stretch',
      fontFamily: fonts.display,
      fontSize: typeScale.money,
      color: colors.text,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    method: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    methodText: { fontSize: typeScale.body, color: colors.textMuted },
    actions: { gap: spacing.md },
    link: { alignItems: 'center' },
  })
);
