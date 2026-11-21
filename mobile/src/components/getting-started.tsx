import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useAuth } from '../auth/session';
import { useProducts, useSales } from '../db/hooks';
import { useI18n } from '../i18n';
import { hasVisited, hideStartList, isStartListHidden } from '../lib/getting-started';
import { colors, radii, spacing, touch, typeScale } from '../theme/tokens';
import { Card, TextLink } from './ui';

type Step = { key: string; label: string; hint: string; done: boolean; href: Href };

/**
 * A short first-week list on Home: the four things that make up a shop day in
 * StockSure, each one tap away. Steps tick themselves off as the owner does
 * them, so nobody has to explain the app; the list goes away once all are done
 * or the owner hides it.
 */
export function GettingStarted() {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const { data: products, initialLoading: productsLoading } = useProducts();
  const { data: sales, initialLoading: salesLoading } = useSales();
  const [hidden, setHidden] = useState(isStartListHidden);
  const [visited, setVisited] = useState({ reconcile: false, tax: false });

  // Re-read on focus: visiting Reconcile or Tax ticks its step on return.
  useFocusEffect(
    useCallback(() => {
      setVisited({ reconcile: hasVisited('reconcile'), tax: hasVisited('tax') });
    }, []),
  );

  const steps: Step[] = [
    ...(can('products.manage')
      ? [
          {
            key: 'product',
            label: t('home.start.product'),
            hint: t('home.start.product.hint'),
            done: products.length > 0,
            href: '/product/new' as Href,
          },
        ]
      : []),
    {
      key: 'sale',
      label: t('home.start.sale'),
      hint: t('home.start.sale.hint'),
      done: sales.length > 0,
      href: '/sale/new',
    },
    ...(can('cash.count')
      ? [
          {
            key: 'reconcile',
            label: t('home.start.reconcile'),
            hint: t('home.start.reconcile.hint'),
            done: visited.reconcile,
            href: '/(tabs)/reconcile' as Href,
          },
        ]
      : []),
    ...(can('tax.view')
      ? [
          {
            key: 'tax',
            label: t('home.start.tax'),
            hint: t('home.start.tax.hint'),
            done: visited.tax,
            href: '/(tabs)/tax' as Href,
          },
        ]
      : []),
  ];

  const done = steps.filter((step) => step.done).length;
  if (hidden || productsLoading || salesLoading || done === steps.length) return null;
  // The first unfinished step is the one we point at.
  const nextKey = steps.find((step) => !step.done)?.key;

  return (
    <Animated.View exiting={FadeOut.duration(200)}>
      <Card>
        <Text style={styles.title} accessibilityRole="header">
          {t('home.start.title')}
        </Text>
        <Text style={styles.progressText}>{t('home.start.progress', { done, total: steps.length })}</Text>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: steps.length, now: done }}
        >
          <View style={[styles.fill, { width: `${(done / steps.length) * 100}%` }]} />
        </View>

        <View style={styles.list}>
          {steps.map((step, index) => {
            const isNext = step.key === nextKey;
            return (
              <Pressable
                key={step.key}
                accessibilityRole="button"
                accessibilityLabel={`${step.label}. ${step.done ? t('home.start.done') : step.hint}`}
                accessibilityState={{ checked: step.done }}
                onPress={() => router.push(step.href)}
                style={({ pressed }) => [styles.step, isNext && styles.stepNext, pressed && styles.pressed]}
              >
                <View style={[styles.badge, step.done && styles.badgeDone, isNext && styles.badgeNext]}>
                  {step.done ? (
                    <Text style={styles.badgeTick}>✓</Text>
                  ) : (
                    <Text style={[styles.badgeText, isNext && styles.badgeTextNext]}>{index + 1}</Text>
                  )}
                </View>
                <View style={styles.stepText}>
                  <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
                  <Text style={styles.stepHint}>{step.done ? t('home.start.done') : step.hint}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <TextLink
          label={t('home.start.hide')}
          onPress={() => {
            hideStartList();
            setHidden(true);
          }}
        />
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text },
  progressText: { fontSize: typeScale.label, color: colors.textMuted },
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.success },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  step: {
    minHeight: touch.minHeight + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  stepNext: { backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.6 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  badgeNext: { borderColor: colors.primary, backgroundColor: colors.primary },
  badgeDone: { borderColor: colors.success, backgroundColor: colors.success },
  badgeText: { fontSize: typeScale.label, fontWeight: '700', color: colors.textMuted },
  badgeTick: { fontSize: typeScale.body, fontWeight: '800', color: colors.primaryText },
  badgeTextNext: { color: colors.primaryText },
  stepText: { flex: 1, gap: 2 },
  stepLabel: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  stepLabelDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  stepHint: { fontSize: typeScale.label, color: colors.textMuted },
});
