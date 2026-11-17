import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Button, Card, Field, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

export default function AccountScreen() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <Screen
      title={t('onboarding.account.title')}
      footer={<Button label={t('onboarding.account.action')} onPress={() => router.push('/onboarding/shop')} />}
    >
      <Card>
        <Field label={t('onboarding.account.name')} placeholder="Elton Chiwala" required />
        <Field label={t('onboarding.account.phone')} placeholder="097 123 4567" keyboardType="phone-pad" required />
        <Field label={t('onboarding.account.pin')} placeholder="••••" keyboardType="numeric" secureTextEntry required />
      </Card>
      <Text style={styles.note}>{t('onboarding.account.note')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: typeScale.label, color: colors.textMuted },
});
