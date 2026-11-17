import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/session';
import { Button } from '@/components/ui';
import { DatabaseProvider } from '@/db/provider';
import { I18nProvider, useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

// The database is initialised once here, before any screen renders, so screens
// can read real data on their very first paint instead of a loading flicker.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <I18nProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </AuthProvider>
        </I18nProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

/**
 * A first run sees language and account only. Once an account exists the app is
 * always locked on a cold start, and the setup screens stay open until the shop
 * is finished. The tab routes are unreachable without a signed-in owner.
 */
function RootNavigator() {
  const { t } = useI18n();
  const { status, error, user, hasOwner, onboardingComplete, refresh } = useAuth();

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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!hasOwner}>
        <Stack.Screen name="onboarding/language" />
        <Stack.Screen name="onboarding/account" />
      </Stack.Protected>

      <Stack.Protected guard={hasOwner && !signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && !onboardingComplete}>
        <Stack.Screen name="onboarding/shop" />
        <Stack.Screen name="onboarding/money" />
        <Stack.Screen name="onboarding/first-products" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="product/new" />
        <Stack.Screen name="product/[id]" />
        <Stack.Screen name="scan" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && onboardingComplete}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="staff" />
        <Stack.Screen name="sale/new" />
        <Stack.Screen name="sale/[id]" />
        <Stack.Screen name="tax/pot" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
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
});
