import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/session';
import { Icon } from '@/components/ui';
import { useAutoSync } from '@/db/use-sync';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

export default function TabsLayout() {
  const { t } = useI18n();
  const { can } = useAuth();
  useAutoSync();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryInk,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: typeScale.caption, fontWeight: '600' },
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
          name="index"
          options={{
            title: t('nav.home'),
            tabBarIcon: ({ color }) => <Icon name="home" color={color} />,
          }}
        />
      <Tabs.Screen
          name="products"
          options={{
            title: t('nav.products'),
            tabBarIcon: ({ color }) => <Icon name="inventory_2" color={color} />,
          }}
        />
      <Tabs.Screen
          name="sales"
          options={{
            title: t('nav.sales'),
            tabBarIcon: ({ color }) => <Icon name="receipt_long" color={color} />,
          }}
        />
      <Tabs.Screen
          name="reconcile"
          options={{
            title: t('nav.reconcile'),
            tabBarIcon: ({ color }) => <Icon name="fact_check" color={color} />,
          }}
        />
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
            tabBarIcon: ({ color }) => <Icon name="account_balance" color={color} />,
          }}
        />
      </Tabs.Protected>
    </Tabs>
  );
}
