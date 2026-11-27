import { Tabs, useRouter } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { useEffect } from 'react';
import { Easing, StyleSheet, Text, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing as ReEasing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/session';
import { PressScale } from '@/components/big-ui';
import { Icon } from '@/components/ui';
import { useAutoSync } from '@/db/use-sync';
import { useI18n } from '@/i18n';
import { colors, elevation, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

export default function TabsLayout() {
  const { t } = useI18n();
  const { can } = useAuth();
  const insets = useSafeAreaInsets();
  useAutoSync();
  // Sit the bar above Android's 3-button bar or gesture strip, with a little
  // breathing room even on phones that report no bottom inset.
  const bottomPad = Math.max(insets.bottom, 0) + 10;
  const reduceMotion = useReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Screens slide a few points and cross-fade when switching tabs. The
        // paper colour behind them stops a white flash mid-transition.
        animation: reduceMotion ? 'none' : 'shift',
        transitionSpec: {
          animation: 'timing',
          config: { duration: 220, easing: Easing.out(Easing.cubic) },
        },
        sceneStyle: { backgroundColor: colors.bg },
        // Tabs you are not looking at stop re-rendering (for example while
        // auto-sync writes), so the JS thread is free when you switch back.
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.primaryInk,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: typeScale.caption, fontWeight: '700' },
        tabBarItemStyle: { paddingTop: 6 },
        tabBarStyle: {
          height: 64 + bottomPad,
          paddingBottom: bottomPad,
          // Floats over the screen so content scrolls faintly behind it. No
          // Android elevation: its shadow would show grey through the glass.
          position: 'absolute',
          borderTopWidth: 0,
          // Fully clear: each screen draws a paper fade behind the bar.
          backgroundColor: 'transparent',
          shadowOpacity: 0,
          elevation: 0,
        },
      }}
    >
      {/*
        Two places each side of Sell, so Sell sits in the middle under the
        thumb: Today, Stock | Sell | Money, Tax. Sales is still a route, reached
        from Home, but kept off the bar.
      */}
      <Tabs.Screen
          name="index"
          options={{
            title: t('nav.today'),
            tabBarIcon: ({ color, focused }) => <TabIcon name="today" color={color} focused={focused} />,
          }}
        />
      <Tabs.Screen
          name="products"
          options={{
            title: t('nav.stock'),
            tabBarIcon: ({ color, focused }) => <TabIcon name="inventory_2" color={color} focused={focused} />,
          }}
        />
      <Tabs.Screen
          name="sell"
          options={{
            title: t('nav.sell'),
            // Owners who have staff do not record sales; they get no Sell button.
            ...(can('sales.record')
              ? { tabBarButton: ({ style }) => <SellTabButton style={style} /> }
              : { href: null }),
          }}
        />
      <Tabs.Screen
          name="reconcile"
          options={{
            title: t('nav.money'),
            tabBarIcon: ({ color, focused }) => <TabIcon name="payments" color={color} focused={focused} />,
          }}
        />
      <Tabs.Screen name="sales" options={{ href: null, title: t('nav.sales') }} />
      {/*
        The same matrix that hides the tax controls also protects the tab, so a
        staff deep link to /tax is not registered and falls back to an available
        screen. Confirm the exact fallback on a device in UAT-21.
      */}
      <Tabs.Protected guard={can('tax.view')}>
        <Tabs.Screen
          name="tax"
          options={{
            title: t('nav.tax'),
            tabBarIcon: ({ color, focused }) => <TabIcon name="account_balance" color={color} focused={focused} />,
          }}
        />
      </Tabs.Protected>
    </Tabs>
  );
}

/**
 * Sell, raised in the middle of the bar: the one action every shop does all
 * day, always in the same place under the thumb. It opens the sale screen
 * instead of switching tabs.
 */
function SellTabButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <View style={[style, styles.sellSlot]}>
      <PressScale onPress={() => router.push('/sale/new')} accessibilityLabel={t('nav.sell')} style={styles.sellPress}>
        <View style={styles.sellButton}>
          <Icon name="point_of_sale" size={iconSize.lg} color={colors.primaryText} />
        </View>
        <Text style={styles.sellLabel} numberOfLines={1} importantForAccessibility="no">
          {t('nav.sell')}
        </Text>
      </PressScale>
    </View>
  );
}

/**
 * The tab symbol on a soft blue pill that grows in when its tab is chosen and
 * fades out as you leave, so the bar shows where you moved instead of jumping.
 */
function TabIcon({ name, color, focused }: { name: AndroidSymbol; color: ColorValue; focused: boolean }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion
      ? (focused ? 1 : 0)
      : withTiming(focused ? 1 : 0, { duration: 220, easing: ReEasing.out(ReEasing.cubic) });
  }, [focused, progress, reduceMotion]);

  const pill = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scaleX: 0.6 + progress.value * 0.4 }],
  }));

  return (
    <Animated.View style={styles.iconWrap}>
      <Animated.View style={[styles.pill, pill]} />
      <Icon name={name} color={color} />
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  sellSlot: { flex: 1 },
  sellPress: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
  // A filled blue pill, wider than the other tab icons, so Sell reads as the
  // one action in the bar.
  sellButton: {
    width: touch.big + spacing.lg,
    height: touch.minHeight - spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    ...elevation.raised,
  },
  sellLabel: { fontSize: typeScale.caption, fontWeight: '700', color: colors.primaryInk },
  iconWrap: { width: 56, height: 30, alignItems: 'center', justifyContent: 'center' },
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
  },
}));
