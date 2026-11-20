import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AndroidSymbol } from 'expo-symbols';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Icon, TextLink } from '@/components/ui';
import { PLANS, TRIAL_DAYS, type PlanId } from '@/core';
import { useI18n } from '@/i18n';
import { continueFree, readPlanChoice, startTrial } from '@/lib/plan-store';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';

const PLAN_ICONS: Record<PlanId, AndroidSymbol> = { standard: 'storefront', pro: 'domain' };
const FEATURE_COUNT = 3;

/**
 * Choosing a plan only starts a free trial, recorded on this phone. Skipping
 * keeps the shop on the free tier. Nothing here takes a payment.
 */
export default function PlanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanId>(() => {
    const stored = readPlanChoice();
    return stored.kind === 'trial' ? stored.plan : 'pro';
  });
  const [error, setError] = useState<string | null>(null);

  function finish(choose: () => void) {
    setError(null);
    try {
      choose();
      router.push('/onboarding/money');
    } catch {
      setError(t('onboarding.plan.error'));
    }
  }

  return (
    <SetupStep
      step={SETUP_STEPS.plan}
      eyebrow={t('onboarding.plan.eyebrow')}
      title={t('onboarding.plan.title')}
      subtitle={t('onboarding.plan.subtitle', { days: TRIAL_DAYS })}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        <View style={styles.footer}>
          <Button
            label={t('onboarding.plan.start', { days: TRIAL_DAYS })}
            onPress={() => finish(() => startTrial(plan))}
          />
          <TextLink
            lead={t('onboarding.plan.skipLead')}
            label={t('onboarding.plan.skipFree')}
            onPress={() => finish(continueFree)}
          />
        </View>
      }
    >
      <View style={styles.plans} accessibilityRole="radiogroup">
        {PLANS.map(({ id, monthlyPriceZmw }) => (
          <PlanCard
            key={id}
            icon={PLAN_ICONS[id]}
            name={t(`onboarding.plan.${id}.name`)}
            price={t('onboarding.plan.perMonth', { amount: monthlyPriceZmw })}
            blurb={t(`onboarding.plan.${id}.blurb`)}
            features={Array.from({ length: FEATURE_COUNT }, (_, i) => t(`onboarding.plan.${id}.feature${i + 1}`))}
            badge={id === 'pro' ? t('onboarding.plan.popular') : undefined}
            selected={plan === id}
            onPress={() => setPlan(id)}
          />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SetupStep>
  );
}

const SPRING = { damping: 12, stiffness: 220, mass: 0.6 };

function PlanCard({
  icon,
  name,
  price,
  blurb,
  features,
  badge,
  selected,
  onPress,
}: {
  icon: AndroidSymbol;
  name: string;
  price: string;
  blurb: string;
  features: string[];
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = useSharedValue(1);
  const pick = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    pick.value = withSpring(selected ? 1 : 0, SPRING);
  }, [pick, selected]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: pick.value,
    transform: [{ scale: interpolate(pick.value, [0, 1], [0.4, 1]) }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(pick.value, [0, 1], [0, -2]) }, { scale: interpolate(pick.value, [0, 1], [1, 1.08]) }],
  }));

  return (
    <Animated.View style={cardStyle}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${name}, ${price}. ${blurb}`}
        onPress={onPress}
        onPressIn={() => press.set(withSpring(0.97, SPRING))}
        onPressOut={() => press.set(withSequence(withSpring(1.01, SPRING), withSpring(1, SPRING)))}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <View style={styles.cardHead}>
          <Animated.View style={[styles.cardIcon, selected && styles.cardIconSelected, iconStyle]}>
            <Icon name={icon} size={30} color={selected ? colors.primaryInk : colors.text} />
          </Animated.View>
          <View style={styles.cardTitles}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{name}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.price}>{price}</Text>
          </View>
          <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
            <Icon name="check" size={16} color={colors.primaryText} />
          </Animated.View>
        </View>
        <Text style={styles.blurb}>{blurb}</Text>
        <View style={styles.features}>
          {features.map((feature) => (
            <View key={feature} style={styles.feature}>
              <Icon name="check" size={16} color={selected ? colors.primaryInk : colors.textMuted} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plans: { gap: spacing.md },
  footer: { gap: spacing.xs },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconSelected: { backgroundColor: colors.surface },
  cardTitles: { flex: 1, gap: spacing.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: typeScale.title, fontWeight: '800', color: colors.text },
  price: { fontSize: typeScale.body, color: colors.text },
  badge: {
    backgroundColor: colors.sand,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeText: { fontSize: typeScale.caption, fontWeight: '800', color: colors.charcoal, letterSpacing: 0.4 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  blurb: { fontSize: typeScale.body, color: colors.text, lineHeight: 22 },
  features: { gap: spacing.xs },
  feature: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureText: { fontSize: typeScale.body, color: colors.text, flexShrink: 1 },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
