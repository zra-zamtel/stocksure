import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DatabaseProvider } from '@/db/provider';
import { I18nProvider } from '@/i18n';

// The database is initialised once here, before any screen renders, so screens
// can read real data on their very first paint instead of a loading flicker.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <I18nProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </I18nProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
