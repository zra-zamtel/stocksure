import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Field, FormError, Icon } from '@/components/ui';
import { NetworkMark } from '@/components/network-mark';
import { OptionCard, OptionGrid, SETUP_STEPS, SetupStep, StepSection } from '@/components/onboarding';
import { isValidTpin } from '@/core';
import { useShop } from '@/db/hooks';
import { saveMoneySettings } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, fonts, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

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
  const [tpinError, setTpinError] = useState<string | null>(null);
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
    setTpinError(null);
    if (registered && tpin.trim() && !isValidTpin(tpin)) {
      setTpinError(t('onboarding.money.tpinInvalid'));
      return;
    }

    setSaving(true);
    try {
      await saveMoneySettings(db, {
        providers,
        turnoverTaxRegistered: registered,
        tpin: registered ? tpin.trim() || undefined : undefined,
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
      <StepSection>{t('onboarding.money.networksAsk')}</StepSection>
      <View style={styles.networks}>
        {PROVIDERS.map((provider) => {
          const selected = providers.includes(provider);
          return (
            <Pressable
              key={provider}
              accessibilityRole="checkbox"
              accessibilityLabel={provider}
              accessibilityState={{ checked: selected }}
              android_ripple={{ color: colors.ripple }}
              onPress={() => toggle(provider)}
              style={[styles.network, selected ? styles.networkOn : styles.networkOff]}
            >
              <NetworkMark provider={provider} size={touch.big} />
              <Text style={styles.networkName}>{provider}</Text>
              {selected ? (
                <View style={styles.check}>
                  <Icon name="check_circle" size={20} color={colors.primary} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <StepSection>{t('onboarding.money.taxAsk')}</StepSection>
      <OptionGrid>
        <OptionCard
          icon="account_balance"
          title={t('onboarding.money.taxYes')}
          selected={registered}
          onPress={() => setRegistered(true)}
        />
        <OptionCard
          icon="do_not_disturb_on"
          title={t('onboarding.money.taxNo')}
          selected={!registered}
          onPress={() => setRegistered(false)}
        />
      </OptionGrid>

      {registered ? (
        <Field
          label={t('onboarding.money.taxNumber')}
          value={tpin}
          onChangeText={(value) => {
            setTpin(value.replace(/\D/g, ''));
            setTpinError(null);
          }}
          error={tpinError}
          autoComplete="off"
          keyboardType="numeric"
          maxLength={10}
          hint={t('onboarding.money.taxNumberHint')}
        />
      ) : null}

      {error ? <FormError message={error} /> : null}
    </SetupStep>
  );
}

const styles = themed(() => StyleSheet.create({
  networks: { flexDirection: 'row', gap: spacing.sm },
  network: {
    flex: 1,
    minHeight: touch.big * 2,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  networkOff: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm + 2 - StyleSheet.hairlineWidth,
  },
  networkOn: { borderWidth: 2, borderColor: colors.primary, padding: spacing.sm },
  networkName: { fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text },
  check: { position: 'absolute', top: spacing.xs, right: spacing.xs },
}));
