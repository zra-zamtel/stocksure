import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Field, FormError, HelpTip, TextLink } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  normalisePin,
  validateOwnerAccount,
  type AccountErrorCode,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

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

type FieldName = 'name' | 'phone' | 'email' | 'password' | 'pin';

/** Which box each problem belongs to, so the message sits right under it. */
const ERROR_FIELDS: Record<AccountErrorCode, FieldName> = {
  'name-required': 'name',
  'phone-invalid': 'phone',
  'email-required': 'email',
  'email-invalid': 'email',
  'password-invalid': 'password',
  'password-mismatch': 'password',
  'pin-invalid': 'pin',
  'pin-mismatch': 'pin',
};

const API_ERROR_FIELDS: Partial<Record<ApiErrorCode, FieldName>> = {
  'duplicate-phone': 'phone',
  'duplicate-email': 'email',
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [saving, setSaving] = useState(false);

  // Typing in a box clears its own message, so the owner sees the fix land.
  const edit = (field: FieldName, set: (value: string) => void) => (value: string) => {
    set(value);
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const reveal = { show: t('common.showTyped'), hide: t('common.hideTyped') };

  async function submit() {
    if (saving) return;
    setError(null);
    setFieldErrors({});
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
      const next: Partial<Record<FieldName, string>> = {};
      for (const code of errors) next[ERROR_FIELDS[code]] ??= t(ERROR_KEYS[code]);
      setFieldErrors(next);
      // The footer button can be far below the first bad box, so say where to look.
      setError(t('onboarding.account.error.checkFields'));
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
        const message = t(API_ERROR_KEYS[cause.code] ?? 'onboarding.account.error.server');
        const field = API_ERROR_FIELDS[cause.code];
        if (field) {
          setFieldErrors({ [field]: message });
          setError(t('onboarding.account.error.checkFields'));
        } else {
          setError(message);
        }
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
          loading={saving}
          onPress={submit}
        />
      }
    >
      <View style={styles.fields}>
        <Field
          label={t('onboarding.account.name')}
          value={name}
          onChangeText={edit('name', setName)}
          hint={t('onboarding.account.hint.name')}
          error={fieldErrors.name}
          placeholder="Elton Chiwala"
          icon="person"
          autoCapitalize="words"
          required
        />
        <Field
          label={t('onboarding.account.phone')}
          value={phone}
          onChangeText={edit('phone', setPhone)}
          hint={t('onboarding.account.hint.phone')}
          error={fieldErrors.phone}
          placeholder="97 123 4567"
          keyboardType="phone-pad"
          prefix="🇿🇲 +260"
          required
        />
        <Field
          label={t('onboarding.account.email')}
          value={email}
          onChangeText={edit('email', setEmail)}
          hint={t('onboarding.account.hint.email')}
          error={fieldErrors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          icon="mail"
          required
        />
        <Field
          label={t('onboarding.account.password')}
          value={password}
          onChangeText={edit('password', setPassword)}
          hint={t('onboarding.account.hint.password')}
          error={fieldErrors.password}
          placeholder={t('onboarding.account.passwordHint')}
          icon="lock"
          secureTextEntry
          revealLabels={reveal}
          required
        />
        <Field
          label={t('onboarding.account.pin')}
          value={pin}
          onChangeText={edit('pin', (value) => setPin(normalisePin(value)))}
          hint={t('onboarding.account.hint.pin')}
          error={fieldErrors.pin}
          placeholder="••••"
          keyboardType="numeric"
          icon="dialpad"
          secureTextEntry
          revealLabels={reveal}
          maxLength={MAX_PIN_LENGTH}
          required
        />
      </View>

      <HelpTip icon="wifi">{t('onboarding.account.note')}</HelpTip>

      {error ? <FormError message={error} /> : null}

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
  links: { alignItems: 'center' },
});
