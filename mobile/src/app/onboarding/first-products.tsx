import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function FirstProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <Screen title={t('onboarding.products.title')}>
      <Card>
        <Text style={styles.hint}>{t('products.empty')}</Text>
      </Card>
      <View style={styles.actions}>
        <Button label={t('onboarding.products.addNow')} onPress={() => router.push('/product/new')} />
        <Button
          label={t('onboarding.products.scan')}
          variant="secondary"
          onPress={() => router.push('/product/new')}
        />
        <Button label={t('common.skip')} variant="secondary" onPress={() => router.replace('/(tabs)')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: typeScale.label, color: colors.textMuted },
  actions: { gap: spacing.md, marginTop: spacing.md },
});
