import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Choice, Field, Row, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { spacing } from '@/theme/tokens';

const PROVIDERS = ['MTN', 'Airtel', 'Zamtel'] as const;

export default function MoneyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [providers, setProviders] = useState<string[]>(['MTN', 'Airtel']);
  const [registered, setRegistered] = useState(true);

  const toggle = (provider: string) =>
    setProviders((current) =>
      current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]
    );

  return (
    <Screen
      title={t('onboarding.money.title')}
      footer={<Button label={t('common.next')} onPress={() => router.push('/onboarding/first-products')} />}
    >
      <Card>
        <Row label={t('onboarding.money.currency')} value="ZMW (K)" />
        <View style={styles.group}>
          {PROVIDERS.map((provider) => (
            <Choice
              key={provider}
              label={provider}
              selected={providers.includes(provider)}
              onPress={() => toggle(provider)}
            />
          ))}
        </View>
        <Choice
          label={`${t('onboarding.money.registered')}: ${registered ? 'Yes' : 'No'}`}
          selected={registered}
          onPress={() => setRegistered((value) => !value)}
        />
        <Field label={t('onboarding.money.tpin')} placeholder={t('common.optional')} keyboardType="numeric" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm, marginVertical: spacing.sm },
});
