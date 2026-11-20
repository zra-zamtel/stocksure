import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Choice, Field } from '@/components/ui';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import type { ShopType } from '@/core';
import { useShop } from '@/db/hooks';
import { saveShopDetails } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

const SHOP_TYPES: ShopType[] = ['clothes', 'shoes', 'general', 'other'];

export default function ShopScreen() {
  const { t, language } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { refresh } = useAuth();
  const { data: shop } = useShop();

  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [shopType, setShopType] = useState<ShopType>('clothes');
  const [usesBarcodes, setUsesBarcodes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill the form once from an existing shop (a resumed setup or an upgrade),
  // without overwriting edits when the focus hook refreshes.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!shop || hydrated.current) return;
    setName(shop.name);
    setTown(shop.town);
    setShopType(shop.type);
    setUsesBarcodes(shop.usesBarcodes);
    hydrated.current = true;
  }, [shop]);

  async function handleNext() {
    if (saving) return;
    setError(null);
    if (!name.trim()) return setError(t('onboarding.shop.error.nameRequired'));
    if (!town.trim()) return setError(t('onboarding.shop.error.townRequired'));

    setSaving(true);
    try {
      await saveShopDetails(db, { name, type: shopType, town, language, usesBarcodes });
      await refresh();
      router.push('/onboarding/money');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupStep
      step={SETUP_STEPS.shop}
      title={t('onboarding.shop.title')}
      subtitle={t('onboarding.shop.subtitle')}
      footer={<Button label={t('common.next')} disabled={saving} onPress={handleNext} />}
    >
      <Card>
        <Field
          label={t('onboarding.shop.name')}
          value={name}
          onChangeText={setName}
          placeholder="Chiwala Fashions"
          required
        />
        <Field
          label={t('onboarding.shop.town')}
          value={town}
          onChangeText={setTown}
          placeholder="Lusaka"
          required
        />
      </Card>

      <Text style={styles.sectionLabel}>{t('onboarding.shop.type')}</Text>
      <View style={styles.group}>
        {SHOP_TYPES.map((type) => (
          <Choice
            key={type}
            label={t(`onboarding.shop.type.${type}`)}
            selected={shopType === type}
            onPress={() => setShopType(type)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('onboarding.shop.barcodes')}</Text>
      <View style={styles.row}>
        <View style={styles.rowChoice}>
          <Choice label={t('common.yes')} selected={usesBarcodes} onPress={() => setUsesBarcodes(true)} />
        </View>
        <View style={styles.rowChoice}>
          <Choice label={t('common.no')} selected={!usesBarcodes} onPress={() => setUsesBarcodes(false)} />
        </View>
      </View>
      <Text style={styles.hint}>{t('onboarding.shop.barcodesHint')}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: typeScale.label, fontWeight: '600', color: colors.textMuted },
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowChoice: { flex: 1 },
  hint: { fontSize: typeScale.label, color: colors.textMuted },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
