import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LanguageBubbles } from '@/components/onboarding';
import { Button, Choice, Screen } from '@/components/ui';
import { LANGUAGE_LABELS, useI18n, type Language } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

// A Zambian street market, faded at the bottom into the paper colour so the
// screen reads as one page rather than a photo stuck on top.
const MARKET = require('../../../assets/images/market-hero.jpg');

export default function LanguageScreen() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();

  return (
    <Screen footer={<Button label={t('common.next')} onPress={() => router.push('/onboarding/account')} />}>
      <Animated.View entering={FadeIn.duration(500)} style={styles.hero}>
        <Image
          source={MARKET}
          style={styles.heroImage}
          contentFit="cover"
          accessible={false}
          transition={200}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(380).delay(120)} style={styles.heading}>
        <Text style={styles.eyebrow}>{t('onboarding.language.eyebrow')}</Text>
        <Text style={styles.title} accessibilityRole="header">
          {t('onboarding.language.title')}
        </Text>
        <Text style={styles.subtitle}>{t('onboarding.language.subtitle')}</Text>
      </Animated.View>

      <LanguageBubbles language={language} />

      <View style={styles.choices} accessibilityRole="radiogroup">
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
  // Bleed past the screen's side and top padding so the picture runs edge to edge.
  hero: { marginHorizontal: -spacing.lg, marginTop: -spacing.lg },
  heroImage: { width: '100%', aspectRatio: 1200 / 670 },
  heading: { alignItems: 'center', gap: spacing.xs, marginTop: -spacing.lg },
  eyebrow: {
    fontSize: typeScale.label,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.primaryInk,
  },
  title: { fontSize: typeScale.display, fontWeight: '800', color: colors.text, textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center' },
  choices: { gap: spacing.md },
});
