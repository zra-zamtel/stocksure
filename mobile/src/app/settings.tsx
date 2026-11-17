import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { shop, taxRules } from '@/data/fake';
import { LANGUAGE_LABELS, useI18n, type Language } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function SettingsScreen() {
  const { t, language } = useI18n();
  const router = useRouter();

  return (
    <Screen title={t('settings.title')} subtitle={shop.name}>
      <SectionTitle>{t('settings.language')}</SectionTitle>
      <Card>
        <Row label={t('settings.language')} value={LANGUAGE_LABELS[language as Language]} />
      </Card>

      <SectionTitle>{t('settings.shop')}</SectionTitle>
      <Card>
        <Row label={t('onboarding.shop.town')} value={shop.town} />
        <Row label={t('onboarding.shop.type')} value={shop.type} />
        <Row label={t('onboarding.money.tpin')} value={shop.tpin ?? t('common.notYet')} />
        <Row label={t('onboarding.shop.barcodes')} value={shop.usesBarcodes ? 'On' : 'Off'} />
      </Card>

      <SectionTitle>{t('settings.staff')}</SectionTitle>
      <Card>
        <Pill label={t('staff.role.owner')} tone="info" />
        <Text style={styles.muted} onPress={() => router.push('/staff')}>
          {t('staff.title')} →
        </Text>
      </Card>

      <SectionTitle>{t('settings.taxRules')}</SectionTitle>
      <Card>
        <Row label={t('tax.rate')} value={`${(taxRules.rate * 100).toFixed(1)}%`} />
        <Row label="Version" value={String(taxRules.version)} />
      </Card>

      <SectionTitle>{t('settings.sync')}</SectionTitle>
      <Card>
        <Row label={t('sync.lastSync')} value={t('sync.never')} />
        <Row label={t('sync.pending')} value="0" />
      </Card>

      <View style={styles.footer}>
        <Text style={styles.muted}>{t('settings.version')} 0.1.0</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  footer: { alignItems: 'center', marginTop: spacing.lg },
});
