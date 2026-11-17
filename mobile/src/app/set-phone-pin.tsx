import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, EmptyState, Field, Screen } from '@/components/ui';
import { MAX_PIN_LENGTH, isValidPin, normalisePin } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, typeScale } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.devicePin.error.offline',
  unauthorized: 'auth.devicePin.error.unauthorized',
  validation: 'auth.devicePin.error.validation',
  server: 'auth.devicePin.error.server',
};

export default function SetPhonePinScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { pendingOwner, completeDeviceSetup, cancelOwnerLogin } = useAuth();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (submitting) return;
    setError(null);

    if (!isValidPin(pin)) {
      setError(t('auth.devicePin.error.pinInvalid'));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('auth.devicePin.error.pinMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await completeDeviceSetup({ pin });
      router.replace('/');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(t(ERROR_KEYS[cause.code] ?? 'auth.devicePin.error.server'));
      } else {
        setError(cause instanceof Error ? cause.message : t('auth.devicePin.error.server'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!pendingOwner) {
    return (
      <Screen title={t('auth.devicePin.title')}>
        <EmptyState message={t('auth.devicePin.noLogin')} />
        <Button
          label={t('auth.email.title')}
          onPress={() => {
            cancelOwnerLogin();
            router.replace('/email-sign-in');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.devicePin.title')}
      subtitle={pendingOwner.owner.email ?? pendingOwner.owner.name}
      footer={
        <Button
          label={submitting ? t('auth.devicePin.saving') : t('auth.devicePin.action')}
          disabled={submitting || pin.length < 4}
          onPress={() => void handleSave()}
        />
      }
    >
      <Card>
        <Text style={styles.body}>{t('auth.devicePin.body')}</Text>
        <Field
          label={t('auth.devicePin.pin')}
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
          label={t('auth.devicePin.confirmPin')}
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
      <Text style={styles.muted}>{t('auth.devicePin.note')}</Text>
      <Button
        label={t('common.cancel')}
        variant="secondary"
        onPress={() => {
          cancelOwnerLogin();
          router.replace('/email-sign-in');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: typeScale.body, color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
});
