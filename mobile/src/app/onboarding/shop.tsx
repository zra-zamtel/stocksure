import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Choice, Field, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { spacing } from '@/theme/tokens';

const SHOP_TYPES = ['clothes', 'shoes', 'general', 'other'] as const;

export default function ShopScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [shopType, setShopType] = useState<(typeof SHOP_TYPES)[number]>('clothes');

  return (
    <Screen
      title={t('onboarding.shop.title')}
      footer={<Button label={t('common.next')} onPress={() => router.push('/onboarding/money')} />}
    >
      <Card>
        <Field label={t('onboarding.shop.name')} placeholder="Chiwala Fashions" required />
        <Field label={t('onboarding.shop.town')} placeholder="Lusaka" required />
        <View style={styles.group}>
          {SHOP_TYPES.map((type) => (
            <Choice key={type} label={type} selected={shopType === type} onPress={() => setShopType(type)} />
          ))}
        </View>
        <Field label={t('onboarding.shop.barcodes')} placeholder="On / Off" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm, marginVertical: spacing.sm },
});
