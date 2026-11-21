import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { EmailReminder } from '@/components/email-reminder';
import type { AndroidSymbol } from 'expo-symbols';
import { Button, Field, FormError } from '@/components/ui';
import { OptionCard, OptionGrid, SETUP_STEPS, SetupStep, StepSection } from '@/components/onboarding';
import type { ShopType } from '@/core';
import { useShop } from '@/db/hooks';
import { saveShopDetails } from '@/db/repos';
import { useI18n } from '@/i18n';
import { spacing } from '@/theme/tokens';

const SHOP_TYPES: { type: ShopType; icon: AndroidSymbol }[] = [
  { type: 'clothes', icon: 'checkroom' },
  { type: 'shoes', icon: 'steps' },
  { type: 'general', icon: 'shopping_basket' },
  { type: 'other', icon: 'category' },
];

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
  const [nameError, setNameError] = useState<string | null>(null);
  const [townError, setTownError] = useState<string | null>(null);
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
    const missingName = !name.trim();
    const missingTown = !town.trim();
    setNameError(missingName ? t('onboarding.shop.error.nameRequired') : null);
    setTownError(missingTown ? t('onboarding.shop.error.townRequired') : null);
    if (missingName || missingTown) return;

    setSaving(true);
    try {
      await saveShopDetails(db, { name, type: shopType, town, language, usesBarcodes });
      await refresh();
      router.push('/onboarding/plan');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupStep
      step={SETUP_STEPS.shop}
      eyebrow={t('onboarding.shop.eyebrow')}
      title={t('onboarding.shop.title')}
      subtitle={t('onboarding.shop.subtitle')}
      footer={<Button label={t('common.next')} disabled={saving} loading={saving} onPress={handleNext} />}
    >
      <EmailReminder />

      <View style={styles.fields}>
        <Field
          label={t('onboarding.shop.name')}
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          hint={t('onboarding.shop.hint.name')}
          error={nameError}
          placeholder="Chiwala Fashions"
          icon="storefront"
          autoCapitalize="words"
          required
        />
        <Field
          label={t('onboarding.shop.town')}
          value={town}
          onChangeText={(value) => {
            setTown(value);
            setTownError(null);
          }}
          hint={t('onboarding.shop.hint.town')}
          error={townError}
          placeholder="Lusaka"
          icon="location_on"
          autoCapitalize="words"
          required
        />
      </View>

      <StepSection>{t('onboarding.shop.type')}</StepSection>
      <OptionGrid>
        {SHOP_TYPES.map(({ type, icon }) => (
          <OptionCard
            key={type}
            icon={icon}
            title={t(`onboarding.shop.type.${type}`)}
            caption={t(`onboarding.shop.type.${type}.caption`)}
            selected={shopType === type}
            onPress={() => setShopType(type)}
          />
        ))}
      </OptionGrid>

      <StepSection>{t('onboarding.shop.howYouSell')}</StepSection>
      <OptionGrid>
        <OptionCard
          icon="barcode_scanner"
          title={t('onboarding.shop.barcodes.yes')}
          caption={t('onboarding.shop.barcodes.yesCaption')}
          selected={usesBarcodes}
          onPress={() => setUsesBarcodes(true)}
        />
        <OptionCard
          icon="list"
          title={t('onboarding.shop.barcodes.no')}
          caption={t('onboarding.shop.barcodes.noCaption')}
          selected={!usesBarcodes}
          onPress={() => setUsesBarcodes(false)}
        />
      </OptionGrid>

      {error ? <FormError message={error} /> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
});
