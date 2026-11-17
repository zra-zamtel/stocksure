import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/session';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

export default function TabsLayout() {
  const { t } = useI18n();
  const { can } = useAuth();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: typeScale.caption, fontWeight: '600' },
        tabBarStyle: { borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.home') }} />
      <Tabs.Screen name="products" options={{ title: t('nav.products') }} />
      <Tabs.Screen name="sales" options={{ title: t('nav.sales') }} />
      <Tabs.Screen name="reconcile" options={{ title: t('nav.reconcile') }} />
      {/*
        The same matrix that hides the tax controls also protects the tab, so a
        staff deep link to /tax is not registered and falls back to an available
        screen. Confirm the exact fallback on a device in UAT-21.
      */}
      <Tabs.Protected guard={can('tax.view')}>
        <Tabs.Screen name="tax" options={{ title: t('nav.tax') }} />
      </Tabs.Protected>
    </Tabs>
  );
}
