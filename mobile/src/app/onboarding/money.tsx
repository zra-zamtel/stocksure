import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Choice, Field, FormError, HelpTip, Row } from '@/components/ui';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { isValidTpin } from '@/core';
import { useShop } from '@/db/hooks';
import { saveMoneySettings } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

const PROVIDERS = ['MTN', 'Airtel', 'Zamtel'] as const;

export default function MoneyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { refresh } = useAuth();
  const { data: shop } = useShop();

  const [providers, setProviders] = useState<string[]>([...PROVIDERS]);
  const [registered, setRegistered] = useState(false);
  const [tpin, setTpin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hydrated = useRef(false);
  useEffect(() => {
    if (!shop || hydrated.current) return;
    setProviders(shop.providers.length > 0 ? shop.providers : [...PROVIDERS]);
    setRegistered(shop.turnoverTaxRegistered);
    setTpin(shop.tpin ?? '');
    hydrated.current = true;
  }, [shop]);

  const toggle = (provider: string) =>
    setProviders((current) =>
      current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]
    );

  async function handleNext() {
    if (saving) return;
    setError(null);
    if (tpin.trim() && !isValidTpin(tpin)) {
      setError(t('onboarding.money.tpinInvalid'));
      return;
    }

    setSaving(true);
    try {
      await saveMoneySettings(db, {
        providers,
        turnoverTaxRegistered: registered,
        tpin: tpin.trim() || undefined,
      });
      await refresh();
      router.push('/onboarding/first-products');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupStep
      step={SETUP_STEPS.money}
      eyebrow={t('onboarding.money.eyebrow')}
      title={t('onboarding.money.title')}
      subtitle={t('onboarding.money.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={<Button label={t('common.next')} disabled={saving} loading={saving} onPress={handleNext} />}
    >
      <Card>
        <Row label={t('onboarding.money.currency')} value="ZMW (K)" />
      </Card>

      <Text style={styles.sectionLabel}>{t('onboarding.money.providers')}</Text>
      <View style={styles.group}>
        {PROVIDERS.map((provider) => (
          <Choice
            key={provider}
            label={provider}
            selected={providers.includes(provider)}
            onPress={() => toggle(provider)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('onboarding.money.registered')}</Text>
      <View style={styles.row}>
        <View style={styles.rowChoice}>
          <Choice label={t('common.yes')} selected={registered} onPress={() => setRegistered(true)} />
        </View>
        <View style={styles.rowChoice}>
          <Choice label={t('common.no')} selected={!registered} onPress={() => setRegistered(false)} />
        </View>
      </View>

      <HelpTip>{t('onboarding.money.registeredTip')}</HelpTip>

      <Card>
        <Field
          label={t('onboarding.money.tpin')}
          value={tpin}
          onChangeText={(value) => setTpin(value.replace(/\D/g, ''))}
          placeholder={t('common.optional')}
          keyboardType="numeric"
          maxLength={10}
        />
        <Text style={styles.hint}>{t('onboarding.money.tpinHint')}</Text>
      </Card>

      {error ? <FormError message={error} /> : null}
    </SetupStep>
  );
}

const styles = themed(() => StyleSheet.create({
  sectionLabel: { fontSize: typeScale.label, fontWeight: '600', color: colors.textMuted },
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowChoice: { flex: 1 },
  hint: { fontSize: typeScale.label, color: colors.textMuted },
}));
