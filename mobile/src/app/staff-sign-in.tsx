import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Field, Screen } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  isValidPhone,
  isValidPin,
  normalisePin,
  normalisePhone,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, typeScale } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'staff.signIn.error.offline',
  'phone-not-found': 'staff.signIn.error.notStaff',
  unauthorized: 'staff.signIn.error.wrongPin',
  'too-many-attempts': 'staff.signIn.error.tooMany',
  validation: 'staff.signIn.error.validation',
  server: 'staff.signIn.error.server',
};

export default function StaffSignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signInStaff } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (submitting) return;
    setError(null);

    if (!isValidPhone(phone)) {
      setError(t('staff.signIn.error.phoneInvalid'));
      return;
    }
    if (!isValidPin(pin)) {
      setError(t('staff.signIn.error.pinInvalid'));
      return;
    }

    setSubmitting(true);
    try {
      await signInStaff({ phone: normalisePhone(phone), pin });
      router.replace('/');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(t(ERROR_KEYS[cause.code] ?? 'staff.signIn.error.server'));
      } else {
        setError(cause instanceof Error ? cause.message : t('staff.signIn.error.server'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title={t('staff.signIn.title')}
      subtitle={t('staff.signIn.subtitle')}
      footer={
        <Button
          label={submitting ? t('staff.signIn.submitting') : t('staff.signIn.action')}
          disabled={submitting || phone.trim() === '' || pin.length < 4}
          onPress={handleSignIn}
        />
      }
    >
      <Card>
        <Field
          label={t('staff.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder="096 555 1122"
          keyboardType="phone-pad"
          required
        />
        <Field
          label={t('auth.signIn.pin')}
          value={pin}
          onChangeText={(value) => setPin(normalisePin(value))}
          placeholder="••••"
          keyboardType="numeric"
          secureTextEntry
          maxLength={MAX_PIN_LENGTH}
          required
        />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>{t('staff.signIn.offlineNote')}</Text>
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
