import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Field } from '@/components/ui';
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

type Part = 'name' | 'login' | 'pin';
const PARTS: Part[] = ['name', 'login', 'pin'];

// Which validation codes belong to which part, so each "Next" only checks the
// fields the owner can see.
const PART_ERRORS: Record<Part, AccountErrorCode[]> = {
  name: ['name-required', 'phone-invalid'],
  login: ['email-required', 'email-invalid', 'password-invalid', 'password-mismatch'],
  pin: ['pin-invalid', 'pin-mismatch'],
};

export default function AccountScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { registerOwner } = useAuth();

  const [part, setPart] = useState<Part>('name');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const index = PARTS.indexOf(part);

  function errorsFor(parts: Part[]) {
    const all = validateOwnerAccount({ name, phone, email, password, confirmPassword, pin, confirmPin });
    const wanted = new Set(parts.flatMap((p) => PART_ERRORS[p]));
    return all.filter((code) => wanted.has(code));
  }

  function back() {
    setError(null);
    if (index > 0) setPart(PARTS[index - 1]);
    else router.back();
  }

  async function next() {
    if (saving) return;
    setError(null);
    const errors = errorsFor([part]);
    if (errors.length > 0) {
      setError(errors.map((code) => t(ERROR_KEYS[code])).join(' '));
      return;
    }
    if (part !== 'pin') {
      setPart(PARTS[index + 1]);
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
        // Send the owner back to the part that holds the clashing value.
        if (cause.code === 'duplicate-phone') setPart('name');
        if (cause.code === 'duplicate-email') setPart('login');
      } else {
        setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
      }
    } finally {
      setSaving(false);
    }
  }

  const footerLabel =
    part !== 'pin'
      ? t('common.next')
      : saving
        ? t('onboarding.account.connecting')
        : t('onboarding.account.action');

  return (
    <SetupStep
      step={SETUP_STEPS[part]}
      contentKey={part}
      title={t(`onboarding.account.${part}.title`)}
      subtitle={t(`onboarding.account.${part}.subtitle`)}
      onBack={back}
      backLabel={t('common.back')}
      footer={<Button label={footerLabel} disabled={saving} onPress={next} />}
    >
      {part === 'name' ? (
        <>
          <Field
            label={t('onboarding.account.name')}
            value={name}
            onChangeText={setName}
            placeholder="Elton Chiwala"
            autoFocus
            required
          />
          <Field
            label={t('onboarding.account.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="097 123 4567"
            keyboardType="phone-pad"
            required
          />
        </>
      ) : null}

      {part === 'login' ? (
        <>
          <Field
            label={t('onboarding.account.email')}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="default"
            autoFocus
            required
          />
          <Field
            label={t('onboarding.account.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('onboarding.account.passwordHint')}
            secureTextEntry
            required
          />
          <Field
            label={t('onboarding.account.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            secureTextEntry
            required
          />
        </>
      ) : null}

      {part === 'pin' ? (
        <>
          <Field
            label={t('onboarding.account.pin')}
            value={pin}
            onChangeText={(value) => setPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            autoFocus
            required
          />
          <Field
            label={t('onboarding.account.confirmPin')}
            value={confirmPin}
            onChangeText={(value) => setConfirmPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            required
          />
        </>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {part === 'name' ? (
        <View style={styles.links}>
          <Button
            label={t('onboarding.account.signIn')}
            variant="secondary"
            onPress={() => router.push('/email-sign-in')}
          />
          <Button
            label={t('onboarding.account.staff')}
            variant="secondary"
            onPress={() => router.push('/staff-sign-in')}
          />
        </View>
      ) : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  links: { gap: spacing.sm, marginTop: spacing.xl },
  error: { fontSize: typeScale.body, color: colors.danger, fontWeight: '600' },
});
