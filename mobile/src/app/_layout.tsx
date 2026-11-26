import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols/400Regular';
import { SpaceGrotesk_700Bold, useFonts } from '@expo-google-fonts/space-grotesk';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, usePathname, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/session';
import { AnimatedSplash } from '@/components/animated-splash';
import { Button } from '@/components/ui';
import { canAccessScreen } from '@/core';
import { DatabaseProvider } from '@/db/provider';
import { I18nProvider, useI18n } from '@/i18n';
import { colors, spacing, themed, typeScale, useScheme } from '@/theme/tokens';

// The database is initialised once here, before any screen renders, so screens
// can read real data on their very first paint instead of a loading flicker.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <I18nProvider>
          <AuthProvider>
            <ThemedStatusBar />
            <AppShell />
          </AuthProvider>
        </I18nProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

/**
 * The animated splash sits on top of the app until the session and the brand
 * font are ready and the animation has played, then fades away and unmounts.
 */
function ThemedStatusBar() {
  const scheme = useScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Redraws every screen when the theme changes (from Settings or the phone's
 * own dark mode), then puts the owner back on the screen they were on. Auth,
 * data and the splash sit above this, so nothing is lost or replayed.
 */
function ThemedNavigator() {
  const scheme = useScheme();
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const shownScheme = useRef(scheme);

  useEffect(() => {
    lastPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (shownScheme.current === scheme) return;
    shownScheme.current = scheme;
    const path = lastPath.current;
    if (!path || path === '/') return;
    // Wait a frame so the fresh navigator has mounted before going back.
    requestAnimationFrame(() => router.replace(path as Href));
  }, [scheme]);

  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    };
  }, [scheme]);

  return (
    <ThemeProvider value={navigationTheme}>
      <RootNavigator key={scheme} />
    </ThemeProvider>
  );
}

function AppShell() {
  const { status } = useAuth();
  // Re-render on a theme change so the shell's own background follows it.
  useScheme();
  // Both fonts load before the splash lifts, so no icon or heading paints blank.
  const [fontsLoaded, fontError] = useFonts({ SpaceGrotesk_700Bold, MaterialSymbols_400Regular });
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  const ready = status !== 'loading' && (fontsLoaded || fontError !== null);

  return (
    <View style={styles.shell}>
      <ThemedNavigator />
      {splashDone ? null : <AnimatedSplash ready={ready} onDone={finishSplash} />}
    </View>
  );
}

/**
 * A first run sees language and account only. Once an account exists the app is
 * always locked on a cold start, and the setup screens stay open until the shop
 * is finished. Owner-only screens are protected here, so a staff member cannot
 * reach one by deep link, while the same permission matrix hides their controls.
 */
function RootNavigator() {
  const { t } = useI18n();
  const {
    status,
    error,
    user,
    pendingOwner,
    hasOwner,
    hasAccount,
    hasShop,
    shopRestorePending,
    onboardingComplete,
    refresh,
    can,
  } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>{t('app.name')}</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorTitle}>{t('auth.databaseError')}</Text>
        <Text style={styles.muted}>{error}</Text>
        <Button label={t('common.retry')} onPress={() => void refresh()} />
      </View>
    );
  }

  const signedIn = user !== null;
  const isOwner = user?.role === 'owner';
  const ownerOnly = signedIn && onboardingComplete;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      {/* Open in every state: a signed-in owner taps the link to confirm their email. */}

      <Stack.Protected guard={!hasAccount && pendingOwner === null}>
        <Stack.Screen name="onboarding/language" />
        <Stack.Screen name="onboarding/account" />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="email-sign-in" />
        <Stack.Screen name="staff-sign-in" />
      </Stack.Protected>

      <Stack.Protected guard={pendingOwner !== null && !signedIn}>
        <Stack.Screen name="set-phone-pin" />
      </Stack.Protected>

      <Stack.Protected guard={hasAccount && !signedIn && pendingOwner === null}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>

      <Stack.Protected guard={hasOwner && !signedIn && pendingOwner === null}>
        <Stack.Screen name="pin-reset" />
      </Stack.Protected>

      <Stack.Protected
        guard={signedIn && isOwner && !onboardingComplete && !shopRestorePending}
      >
        <Stack.Screen name="onboarding/shop" />
        <Stack.Screen name="onboarding/plan" />
        <Stack.Screen name="onboarding/money" />
        <Stack.Screen name="onboarding/first-products" />
      </Stack.Protected>

      <Stack.Protected
        guard={
          signedIn &&
          ((user?.role === 'staff' && (!hasShop || !onboardingComplete)) ||
            (!hasShop && shopRestorePending))
        }
      >
        <Stack.Screen name="shop-pending" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && canAccessScreen(user?.role, 'productNew')}>
        <Stack.Screen name="product/new" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && canAccessScreen(user?.role, 'productDetail')}>
        <Stack.Screen name="product/[id]" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && canAccessScreen(user?.role, 'scan')}>
        <Stack.Screen name="scan" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && onboardingComplete && can('sales.record')}>
        <Stack.Screen name="sale/new" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && onboardingComplete}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sale/[id]" />
      </Stack.Protected>

      <Stack.Protected guard={ownerOnly && canAccessScreen(user?.role, 'settings')}>
        <Stack.Screen name="settings" />
        <Stack.Screen name="smart-invoice" />
      </Stack.Protected>

      <Stack.Protected guard={ownerOnly && canAccessScreen(user?.role, 'staff')}>
        <Stack.Screen name="staff" />
      </Stack.Protected>

      <Stack.Protected guard={ownerOnly && canAccessScreen(user?.role, 'paymentMessage')}>
        <Stack.Screen name="payment-message" />
      </Stack.Protected>

      <Stack.Protected guard={ownerOnly && canAccessScreen(user?.role, 'insights')}>
        <Stack.Screen name="insights" />
      </Stack.Protected>

      <Stack.Protected guard={ownerOnly && canAccessScreen(user?.role, 'taxPot')}>
        <Stack.Screen name="tax/pot" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = themed(() => StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  muted: { fontSize: typeScale.label, color: colors.textMuted, textAlign: 'center' },
  errorTitle: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, textAlign: 'center' },
}));
