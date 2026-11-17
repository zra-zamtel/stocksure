import { Tabs } from 'expo-router';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

export default function TabsLayout() {
  const { t } = useI18n();

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
      <Tabs.Screen name="tax" options={{ title: t('nav.tax') }} />
    </Tabs>
  );
}
