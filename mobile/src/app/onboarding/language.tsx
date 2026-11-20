import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Logo, SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Choice } from '@/components/ui';
import { LANGUAGE_LABELS, useI18n, type Language } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function LanguageScreen() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();

  return (
    <SetupStep
      step={SETUP_STEPS.language}
      title={t('onboarding.language.title')}
      subtitle={t('onboarding.language.subtitle')}
      footer={<Button label={t('common.next')} onPress={() => router.push('/onboarding/account')} />}
      hero={
        <View style={styles.hero}>
          <Logo />
          <Text style={styles.brand}>{t('app.name')}</Text>
          <Text style={styles.tagline}>{t('onboarding.welcome.tagline')}</Text>
        </View>
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
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  brand: { fontSize: typeScale.title, fontWeight: '700', color: colors.text },
  tagline: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center' },
  choices: { gap: spacing.md },
});
