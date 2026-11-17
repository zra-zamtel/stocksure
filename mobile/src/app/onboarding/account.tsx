import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Field, Screen } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  normalisePin,
  validateOwnerAccount,
  type AccountErrorCode,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, typeScale } from '@/theme/tokens';

const ERROR_KEYS: Record<AccountErrorCode, string> = {
  'name-required': 'onboarding.account.error.nameRequired',
  'phone-invalid': 'onboarding.account.error.phoneInvalid',
  'pin-invalid': 'onboarding.account.error.pinInvalid',
  'pin-mismatch': 'onboarding.account.error.pinMismatch',
};

const API_ERROR_KEYS: Record<ApiErrorCode, string> = {
  offline: 'onboarding.account.error.offline',
  'duplicate-phone': 'onboarding.account.error.duplicatePhone',
  validation: 'onboarding.account.error.validation',
  server: 'onboarding.account.error.server',
};

export default function AccountScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { registerOwner } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (saving) return;
    setError(null);

    const errors = validateOwnerAccount({ name, phone, pin, confirmPin });
    if (errors.length > 0) {
      setError(errors.map((code) => t(ERROR_KEYS[code])).join(' '));
      return;
    }

    setSaving(true);
    try {
      await registerOwner({ name, phone, pin });
      // Registration just completed against the backend. The index gate sends
      // the owner to the next unfinished setup step.
      router.replace('/');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(t(API_ERROR_KEYS[cause.code]));
      } else {
        setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      title={t('onboarding.account.title')}
      footer={
        <Button
          label={saving ? t('onboarding.account.connecting') : t('onboarding.account.action')}
          disabled={saving}
          onPress={handleCreate}
        />
      }
    >
      <Card>
        <Field
          label={t('onboarding.account.name')}
          value={name}
          onChangeText={setName}
          placeholder="Elton Chiwala"
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
        <Field
          label={t('onboarding.account.pin')}
          value={pin}
          onChangeText={(value) => setPin(normalisePin(value))}
          placeholder="••••"
          keyboardType="numeric"
          secureTextEntry
          maxLength={MAX_PIN_LENGTH}
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
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>{t('onboarding.account.note')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: typeScale.label, color: colors.textMuted },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
