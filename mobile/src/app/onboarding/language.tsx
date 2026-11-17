import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Choice, Screen } from '@/components/ui';
import { LANGUAGE_LABELS, useI18n, type Language } from '@/i18n';
import { spacing } from '@/theme/tokens';

export default function LanguageScreen() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();

  return (
    <Screen
      title={t('onboarding.language.title')}
      subtitle={t('onboarding.language.subtitle')}
      footer={
        <Button label={t('common.next')} onPress={() => router.push('/onboarding/account')} />
      }
    >
      <View style={styles.choices}>
        {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
          <Choice
            key={code}
            label={LANGUAGE_LABELS[code]}
            selected={language === code}
            onPress={() => setLanguage(code)}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: spacing.md, marginTop: spacing.xl },
});
