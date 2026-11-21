import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AndroidSymbol } from 'expo-symbols';
import Animated, {
  FadeInRight,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BrandMark, Wordmark } from './brand';
import { Icon, Screen } from './ui';
import { useI18n } from '../i18n';
import { colors, radii, spacing, touch, typeScale } from '../theme/tokens';

/**
 * Setup runs as one stepped flow. Every numbered screen shares this frame so
 * the owner always sees how far along they are ("2 of 4"), and every "Next"
 * visibly moves something: the bar fills and the new step slides in. Choosing
 * a language comes before the count starts.
 */
export const SETUP_STEPS = {
  account: 1,
  shop: 2,
  plan: 3,
  money: 4,
  products: 5,
} as const;
export const SETUP_TOTAL = 5;

type Props = {
  /** Omit outside setup (e.g. sign-in): no progress bar or step count. */
  step?: number;
  /** Small blue label above the title, e.g. "SHOP SETUP". */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Changes whenever the content should replay its entrance, e.g. a sub-step. */
  contentKey?: string;
  onBack?: () => void;
  backLabel?: string;
  footer: ReactNode;
  /** Shown above the title. */
  hero?: ReactNode;
  children?: ReactNode;
};

export function SetupStep({
  step,
  eyebrow,
  title,
  subtitle,
  contentKey,
  onBack,
  backLabel,
  footer,
  hero,
  children,
}: Props) {
  const { t } = useI18n();
  const stepLabel = step === undefined ? null : t('common.stepOf', { step, total: SETUP_TOTAL });
  return (
    <Screen footer={footer}>
      {onBack || step !== undefined ? (
      <View style={styles.top}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Icon name="arrow_back" color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        {step !== undefined ? <Progress step={step} /> : null}
        {stepLabel ? <Text style={styles.stepLabel}>{stepLabel}</Text> : null}
      </View>
      ) : null}

      <Animated.View key={contentKey ?? title} entering={FadeInRight.duration(260)} style={styles.content}>
        {hero}
        <View style={styles.heading}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </Animated.View>
    </Screen>
  );
}

function Progress({ step }: { step: number }) {
  const fill = useSharedValue(Math.max(0, step - 1) / SETUP_TOTAL);
  useEffect(() => {
    fill.value = withTiming(step / SETUP_TOTAL, { duration: 350 });
  }, [fill, step]);
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: SETUP_TOTAL, now: step }}
    >
      <Animated.View style={[styles.fill, bar]} />
    </View>
  );
}

/** Uppercase section label inside a setup step, e.g. "SHOP TYPE". */
export function StepSection({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const SPRING = { damping: 12, stiffness: 220, mass: 0.6 };

/**
 * A large tappable card with an icon, a title and a short line under it. Used
 * in a grid where one card is picked. The card dips when pressed, and when it
 * becomes the choice its icon hops and a check badge pops in.
 */
export function OptionCard({
  icon,
  title,
  caption,
  selected,
  onPress,
}: {
  icon: AndroidSymbol;
  title: string;
  caption?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = useSharedValue(1);
  const pick = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    pick.value = withSpring(selected ? 1 : 0, SPRING);
  }, [pick, selected]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(pick.value, [0, 1], [0, -3]) },
      { rotate: `${interpolate(pick.value, [0, 1], [0, -8])}deg` },
      { scale: interpolate(pick.value, [0, 1], [1, 1.08]) },
    ],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: pick.value,
    transform: [{ scale: interpolate(pick.value, [0, 1], [0.4, 1]) }],
  }));

  return (
    <Animated.View style={[styles.optionWrap, cardStyle]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={caption ? `${title}. ${caption}` : title}
        onPress={onPress}
        onPressIn={() => {
          press.set(withSpring(0.95, SPRING));
        }}
        onPressOut={() => {
          press.set(withSequence(withSpring(1.02, SPRING), withSpring(1, SPRING)));
        }}
        style={[styles.option, selected && styles.optionSelected]}
      >
        <Animated.View style={[styles.optionIcon, selected && styles.optionIconSelected, iconStyle]}>
          <Icon name={icon} size={30} color={selected ? colors.primaryInk : colors.text} />
        </Animated.View>
        <Text style={styles.optionTitle}>{title}</Text>
        {caption ? <Text style={styles.optionCaption}>{caption}</Text> : null}
        <Animated.View style={[styles.optionBadge, badgeStyle]} pointerEvents="none">
          <Icon name="check" size={14} color={colors.primaryText} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** Lays option cards out two to a row. */
export function OptionGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/**
 * Two speech bubbles, "Hello!" and "Moni!". The bubble for the chosen language
 * swaps to the front with a spring and a blue ring pulses out behind it, so
 * picking a language visibly changes something before the owner reads a word.
 */
export function LanguageBubbles({ language }: { language: 'en' | 'ny' }) {
  const swap = useSharedValue(language === 'ny' ? 1 : 0);
  const ring = useSharedValue(1);

  useEffect(() => {
    swap.value = withSpring(language === 'ny' ? 1 : 0, { damping: 11, stiffness: 160 });
    ring.value = 0;
    ring.value = withTiming(1, { duration: 900 });
  }, [language, ring, swap]);

  // English starts top left, Nyanja bottom right; they trade places.
  const english = useAnimatedStyle(() => ({
    zIndex: swap.value < 0.5 ? 2 : 1,
    opacity: interpolate(swap.value, [0, 1], [1, 0.75]),
    transform: [
      { translateX: interpolate(swap.value, [0, 1], [0, 56]) },
      { translateY: interpolate(swap.value, [0, 1], [0, 34]) },
      { scale: interpolate(swap.value, [0, 1], [1.05, 0.92]) },
    ],
  }));
  const nyanja = useAnimatedStyle(() => ({
    zIndex: swap.value >= 0.5 ? 2 : 1,
    opacity: interpolate(swap.value, [0, 1], [0.75, 1]),
    transform: [
      { translateX: interpolate(swap.value, [0, 1], [0, -56]) },
      { translateY: interpolate(swap.value, [0, 1], [0, -34]) },
      { scale: interpolate(swap.value, [0, 1], [0.92, 1.05]) },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ring.value, [0, 1], [0.7, 0]),
    transform: [{ scale: interpolate(ring.value, [0, 1], [0.8, 1.6]) }],
  }));
  const sparks = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(swap.value, [0, 1], [0, 14])}deg` },
      { scale: interpolate(swap.value, [0, 1], [1, 1.06]) },
    ],
  }));

  return (
    <View style={styles.bubbles} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ring, ringStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, sparks]}>
        <View style={[styles.spark, { top: 14, left: 150, transform: [{ rotate: '-45deg' }] }]} />
        <View style={[styles.spark, { top: 36, left: 168, transform: [{ rotate: '-15deg' }] }]} />
        <View style={[styles.spark, { top: 112, left: 40, transform: [{ rotate: '-45deg' }] }]} />
        <View style={[styles.dot, { top: 10, left: 176 }]} />
        <View style={[styles.dot, styles.dotDark, { top: 34, left: 28 }]} />
      </Animated.View>

      <Animated.View style={[styles.bubble, styles.bubbleEnglish, english]}>
        <Text style={styles.bubbleText}>Hello!</Text>
        <View style={styles.bubbleLine} />
        <View style={[styles.bubbleLine, styles.bubbleLineShort]} />
        <View style={[styles.tail, styles.tailLeft]} />
      </Animated.View>

      <Animated.View style={[styles.bubble, styles.bubbleNyanja, nyanja]}>
        <Text style={[styles.bubbleText, styles.bubbleTextBlue]}>Moni!</Text>
        <View style={[styles.bubbleLine, styles.bubbleLineBlue]} />
        <View style={[styles.bubbleLine, styles.bubbleLineBlue, styles.bubbleLineShort]} />
        <View style={[styles.tail, styles.tailRight, styles.tailBlue]} />
      </Animated.View>
    </View>
  );
}

/** The StockSure mark beside the name, for the top of welcome and sign-in screens. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <View style={styles.logo} accessible accessibilityRole="image" accessibilityLabel="StockSure">
      <BrandMark size={size} />
      <Wordmark size={size * 0.62} />
    </View>
  );
}

const BUBBLE_W = 104;
const BUBBLE_H = 64;

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: {
    width: touch.minWidth,
    height: touch.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    marginLeft: -spacing.md,
  },
  backSpacer: { width: touch.minWidth - spacing.md, height: touch.minHeight },
  pressed: { opacity: 0.6 },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.charcoal },
  stepLabel: { fontSize: typeScale.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  content: { gap: spacing.lg, marginTop: spacing.md },
  heading: { gap: spacing.xs },
  eyebrow: {
    fontSize: typeScale.label,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primaryInk,
  },
  title: { fontSize: typeScale.display, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: typeScale.body, color: colors.textMuted, lineHeight: 22 },
  section: {
    fontSize: typeScale.label,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.text,
    marginBottom: -spacing.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  optionWrap: { flexBasis: '47%', flexGrow: 1 },
  option: {
    minHeight: 132,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.xs,
  },
  optionSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.xs,
  },
  optionIconSelected: { backgroundColor: colors.surface },
  optionTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text, textAlign: 'center' },
  optionCaption: { fontSize: typeScale.label, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
  optionBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbles: { width: 210, height: 140, alignSelf: 'center', marginVertical: spacing.lg },
  ring: {
    position: 'absolute',
    left: 57,
    top: 22,
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  spark: { position: 'absolute', width: 14, height: 2.5, borderRadius: 2, backgroundColor: colors.primary },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  dotDark: { backgroundColor: colors.charcoal },
  bubble: {
    position: 'absolute',
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: 5,
  },
  bubbleEnglish: { left: 22, top: 12, borderColor: colors.charcoal, backgroundColor: colors.surface },
  bubbleNyanja: { left: 78, top: 46, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  bubbleText: { fontSize: typeScale.body, fontWeight: '800', color: colors.charcoal },
  bubbleTextBlue: { color: colors.primaryInk },
  bubbleLine: { height: 3, borderRadius: 2, backgroundColor: colors.border, width: '90%' },
  bubbleLineShort: { width: '60%' },
  bubbleLineBlue: { backgroundColor: colors.primary, opacity: 0.45 },
  // A square turned 45 degrees with two borders, so its lower point reads as the
  // bubble's tail; its fill hides the bubble's bottom border where they meet.
  tail: {
    position: 'absolute',
    bottom: -8,
    width: 14,
    height: 14,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.charcoal,
    backgroundColor: colors.surface,
    transform: [{ rotate: '45deg' }],
  },
  tailLeft: { left: 20 },
  tailRight: { right: 20 },
  tailBlue: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  logo: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: spacing.sm },
});
