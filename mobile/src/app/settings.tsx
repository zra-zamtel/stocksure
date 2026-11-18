import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { taxRules } from '@/data/fake';
import { useShop } from '@/db/hooks';
import { useSync } from '@/db/use-sync';
import { LANGUAGE_LABELS, useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function SettingsScreen() {
  const { t, language } = useI18n();
  const router = useRouter();
  const { ownerPreview, signOut } = useAuth();
  const { data: shop } = useShop();
  const sync = useSync();

  return (
    <Screen title={t('settings.title')} subtitle={shop?.name ?? t('app.name')}>
      <SectionTitle>{t('settings.language')}</SectionTitle>
      <Card>
        <Row label={t('settings.language')} value={LANGUAGE_LABELS[language]} />
      </Card>

      <SectionTitle>{t('settings.shop')}</SectionTitle>
      <Card>
        <Row label={t('onboarding.shop.town')} value={shop?.town ?? t('common.notYet')} />
        <Row
          label={t('onboarding.shop.type')}
          value={shop ? t(`onboarding.shop.type.${shop.type}`) : t('common.notYet')}
        />
        <Row label={t('onboarding.money.tpin')} value={shop?.tpin ?? t('common.notYet')} />
        <Row
          label={t('onboarding.shop.barcodes')}
          value={shop ? (shop.usesBarcodes ? t('common.yes') : t('common.no')) : t('common.notYet')}
        />
      </Card>

      <SectionTitle>{t('settings.staff')}</SectionTitle>
      <Card>
        <Pill label={t('staff.role.owner')} tone="info" />
        <Text style={styles.muted}>{ownerPreview?.name ?? t('common.notYet')}</Text>
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
        <Row
          label={t('sync.lastSync')}
          value={
            sync.lastSyncAt
              ? new Date(sync.lastSyncAt).toLocaleString()
              : t('sync.never')
          }
        />
        <Row label={t('sync.pending')} value={String(sync.pending)} />
        {sync.error ? <Text style={styles.error}>{sync.error}</Text> : null}
        <Button
          label={sync.busy ? t('sync.syncing') : t('sync.now')}
          disabled={sync.busy}
          onPress={() => void sync.syncNow()}
        />
      </Card>

      <SectionTitle>{t('settings.account')}</SectionTitle>
      <Card>
        <Button label={t('settings.signOut')} variant="secondary" onPress={signOut} />
      </Card>

      <View style={styles.footer}>
        <Text style={styles.muted}>{t('settings.version')} 0.1.0</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  footer: { alignItems: 'center', marginTop: spacing.lg },
});
