import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon, Screen } from './ui';
import { colors, radii, spacing, touch, typeScale } from '../theme/tokens';

/**
 * Setup runs as one stepped flow. Every screen in it shares this frame so the
 * owner always sees how far along they are, and every "Next" visibly moves
 * something: the progress bar fills and the new step slides in.
 */
export const SETUP_STEPS = {
  language: 1,
  name: 2,
  login: 3,
  pin: 4,
  shop: 5,
  money: 6,
  products: 7,
} as const;
export const SETUP_TOTAL = 7;

type Props = {
  step: number;
  title: string;
  subtitle?: string;
  /** Changes whenever the content should replay its entrance, e.g. a sub-step. */
  contentKey?: string;
  onBack?: () => void;
  backLabel?: string;
  footer: ReactNode;
  /** Shown above the title, e.g. the logo on the welcome step. */
  hero?: ReactNode;
  children?: ReactNode;
};

export function SetupStep({ step, title, subtitle, contentKey, onBack, backLabel, footer, hero, children }: Props) {
  return (
    <Screen footer={footer}>
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
        <Progress step={step} />
      </View>

      <Animated.View key={contentKey ?? title} entering={FadeInRight.duration(260)} style={styles.content}>
        {hero}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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

/** Placeholder mark until the real logo lands; swap this one component. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Icon name="storefront" size={size * 0.55} color={colors.primaryText} />
    </View>
  );
}

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
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  content: { gap: spacing.md, marginTop: spacing.lg },
  title: { fontSize: typeScale.display, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: typeScale.body, color: colors.textMuted, lineHeight: 22 },
  logo: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
