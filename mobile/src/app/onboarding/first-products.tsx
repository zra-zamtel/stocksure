import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Card } from '@/components/ui';
import { taxRules } from '@/data/fake';
import { useProducts, useShop } from '@/db/hooks';
import { completeOnboarding, ensureTaxPeriod } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function FirstProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { refresh } = useAuth();
  const { data: products, loading } = useProducts();
  const { data: shop } = useShop();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const count = products.length;
  const usesBarcodes = shop?.usesBarcodes ?? false;

  async function finish() {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      // Create the tax period first: if the app dies before the flag is set,
      // setup resumes here and the second attempt is idempotent.
      await ensureTaxPeriod(db, taxRules);
      await completeOnboarding(db);
      await refresh();
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
      setSaving(false);
    }
  }

  const addProduct = () =>
    router.push({ pathname: '/product/new', params: { from: 'onboarding' } });

  return (
    <SetupStep
      step={SETUP_STEPS.products}
      eyebrow={t('onboarding.products.eyebrow')}
      title={t('onboarding.products.title')}
      subtitle={t('onboarding.products.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        count > 0 ? (
          <Button label={t('onboarding.products.finish')} disabled={saving} onPress={finish} />
        ) : (
          <Button label={t('onboarding.products.addNow')} onPress={addProduct} />
        )
      }
    >
      {count > 0 ? (
        <Card>
          <Text style={styles.count}>
            {t(count === 1 ? 'onboarding.products.addedOne' : 'onboarding.products.added', { count })}
          </Text>
        </Card>
      ) : null}
      {loading ? <Text style={styles.hint}>{t('common.syncing')}</Text> : null}

      <View style={styles.actions}>
        {count > 0 ? (
          <Button label={t('onboarding.products.addAnother')} variant="secondary" onPress={addProduct} />
        ) : null}
        {usesBarcodes ? (
          <Button
            label={t('onboarding.products.scan')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/scan', params: { from: 'onboarding' } })}
          />
        ) : null}
        {count === 0 ? (
          <Button label={t('onboarding.products.later')} variant="secondary" disabled={saving} onPress={finish} />
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  hint: { fontSize: typeScale.label, color: colors.textMuted },
  actions: { gap: spacing.md, marginTop: spacing.md },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
