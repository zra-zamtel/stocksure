import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  normalisePin,
  validateOwnerAccount,
  type AccountErrorCode,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, spacing, typeScale } from '@/theme/tokens';

const ERROR_KEYS: Record<AccountErrorCode, string> = {
  'name-required': 'onboarding.account.error.nameRequired',
  'phone-invalid': 'onboarding.account.error.phoneInvalid',
  'email-required': 'onboarding.account.error.emailRequired',
  'email-invalid': 'onboarding.account.error.emailInvalid',
  'password-invalid': 'onboarding.account.error.passwordInvalid',
  'password-mismatch': 'onboarding.account.error.passwordMismatch',
  'pin-invalid': 'onboarding.account.error.pinInvalid',
  'pin-mismatch': 'onboarding.account.error.pinMismatch',
};

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'onboarding.account.error.offline',
  'duplicate-phone': 'onboarding.account.error.duplicatePhone',
  'duplicate-email': 'onboarding.account.error.duplicateEmail',
  'account-conflict': 'onboarding.account.error.accountConflict',
  validation: 'onboarding.account.error.validation',
  server: 'onboarding.account.error.server',
};

/**
 * One screen for the whole account. There are no "confirm" boxes: the password
 * and PIN each have an eye button so the owner can check what they typed, and
 * a forgotten PIN can be reset by email.
 */
export default function AccountScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { registerOwner } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reveal = { show: t('common.showTyped'), hide: t('common.hideTyped') };

  async function submit() {
    if (saving) return;
    setError(null);
    const errors = validateOwnerAccount({
      name,
      phone,
      email,
      password,
      confirmPassword: password,
      pin,
      confirmPin: pin,
    });
    if (errors.length > 0) {
      setError(errors.map((code) => t(ERROR_KEYS[code])).join(' '));
      return;
    }

    setSaving(true);
    try {
      await registerOwner({ name, phone, email, password, pin });
      // Registration just completed against the backend. The index gate sends
      // the owner to the next unfinished setup step.
      router.replace('/');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(t(API_ERROR_KEYS[cause.code] ?? 'onboarding.account.error.server'));
      } else {
        setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupStep
      step={SETUP_STEPS.account}
      eyebrow={t('onboarding.account.eyebrow')}
      title={t('onboarding.account.title')}
      subtitle={t('onboarding.account.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        <Button
          label={saving ? t('onboarding.account.connecting') : t('onboarding.account.action')}
          disabled={saving}
          onPress={submit}
        />
      }
    >
      <View style={styles.fields}>
        <Field
          label={t('onboarding.account.name')}
          value={name}
          onChangeText={setName}
          placeholder="Elton Chiwala"
          icon="person"
          autoCapitalize="words"
          required
        />
        <Field
          label={t('onboarding.account.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder="97 123 4567"
          keyboardType="phone-pad"
          prefix="🇿🇲 +260"
          required
        />
        <Field
          label={t('onboarding.account.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          icon="mail"
          required
        />
        <Field
          label={t('onboarding.account.password')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('onboarding.account.passwordHint')}
          icon="lock"
          secureTextEntry
          revealLabels={reveal}
          required
        />
        <Field
          label={t('onboarding.account.pin')}
          value={pin}
          onChangeText={(value) => setPin(normalisePin(value))}
          placeholder="••••"
          keyboardType="numeric"
          icon="dialpad"
          secureTextEntry
          revealLabels={reveal}
          maxLength={MAX_PIN_LENGTH}
          required
        />
      </View>

      <Text style={styles.note}>{t('onboarding.account.note')}</Text>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.links}>
        <TextLink
          lead={t('onboarding.account.haveAccount')}
          label={t('onboarding.account.signInShort')}
          onPress={() => router.push('/email-sign-in')}
        />
        <TextLink label={t('onboarding.account.staff')} onPress={() => router.push('/staff-sign-in')} />
      </View>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  note: { fontSize: typeScale.label, color: colors.textMuted, lineHeight: 18 },
  links: { alignItems: 'center' },
  error: { fontSize: typeScale.body, color: colors.danger, fontWeight: '600' },
});
