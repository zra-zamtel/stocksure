import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '@/i18n';

// The whole app is wrapped here so every screen reads strings through useI18n
// and every layout sits inside the safe area. Design tokens are not provided
// through context on purpose: they are plain imports, replaced in one file.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </I18nProvider>
    </SafeAreaProvider>
  );
}
