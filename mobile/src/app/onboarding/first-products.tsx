import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { BigTile, ProductTile } from '@/components/big-ui';
import { SETUP_STEPS, SetupStep, StepSection } from '@/components/onboarding';
import { Button, FormError, SkeletonCard, TextLink } from '@/components/ui';
import { taxRules } from '@/data/fake';
import { useProducts, useShop } from '@/db/hooks';
import { completeOnboarding, ensureTaxPeriod } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, themed, touch, typeScale } from '@/theme/tokens';

const TILE_SIZE = touch.big + spacing.lg;

export default function FirstProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { refresh } = useAuth();
  const { data: products, initialLoading } = useProducts();
  const { data: shop } = useShop();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const count = products.length;
  const usesBarcodes = shop?.usesBarcodes ?? false;
  const countLine = t(count === 1 ? 'onboarding.products.addedOne' : 'onboarding.products.added', { count });

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
          <Button label={t('onboarding.products.finish')} disabled={saving} loading={saving} onPress={finish} />
        ) : (
          <TextLink label={t('onboarding.products.later')} onPress={finish} />
        )
      }
    >
      <StepSection>{t('onboarding.products.ask')}</StepSection>
      <View style={styles.tiles}>
        <BigTile
          icon="add_a_photo"
          label={t('onboarding.products.addNow')}
          tone="primary"
          onPress={addProduct}
        />
        {usesBarcodes ? (
          <BigTile
            icon="barcode_scanner"
            label={t('onboarding.products.scan')}
            onPress={() => router.push({ pathname: '/scan', params: { from: 'onboarding' } })}
          />
        ) : null}
      </View>

      {initialLoading ? <SkeletonCard lines={1} /> : null}

      {count > 0 ? (
        <>
          <StepSection>{t('onboarding.products.yours')}</StepSection>
          <Text style={styles.count}>{countLine}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessible
            accessibilityLabel={countLine}
            contentContainerStyle={styles.strip}
          >
            {products.map((p) => (
              <View key={p.id} style={styles.item}>
                <ProductTile
                  id={p.id}
                  name={p.name}
                  category={p.category}
                  photoUri={p.photoUri}
                  size={TILE_SIZE}
                />
                <Text style={styles.name} numberOfLines={2}>
                  {p.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}

      {error ? <FormError message={error} /> : null}
    </SetupStep>
  );
}

const styles = themed(() => StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
  count: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  strip: { gap: spacing.md },
  item: { width: TILE_SIZE, gap: spacing.xs },
  name: { fontSize: typeScale.caption, color: colors.text },
}));
