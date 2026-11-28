import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice, PinBoxes } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, TextLink } from '@/components/ui';
import { isValidPin } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

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
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  function backToEmail() {
    cancelOwnerLogin();
    router.replace('/email-sign-in');
  }

  async function handleSave() {
    if (submitting) return;
    setError(null);
    setPinError(null);
    setConfirmError(null);

    if (!isValidPin(pin)) {
      setPinError(t('auth.devicePin.error.pinInvalid'));
      return;
    }
    if (pin !== confirmPin) {
      setConfirmError(t('auth.devicePin.error.pinMismatch'));
      setShakeKey((key) => key + 1);
      setConfirmPin('');
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
      <SetupStep
        eyebrow={t('auth.devicePin.eyebrow')}
        title={t('auth.devicePin.title')}
        footer={<Button label={t('auth.email.title')} onPress={backToEmail} />}
      >
        <Notice tone="info">{t('auth.devicePin.noLogin')}</Notice>
      </SetupStep>
    );
  }

  return (
    <SetupStep
      eyebrow={t('auth.devicePin.eyebrow')}
      title={t('auth.devicePin.title')}
      subtitle={t('auth.devicePin.body')}
      onBack={backToEmail}
      backLabel={t('common.cancel')}
      footer={
        <Button
          label={submitting ? t('auth.devicePin.saving') : t('auth.devicePin.action')}
          loading={submitting}
          disabled={submitting || pin.length < 4 || confirmPin.length < 4}
          onPress={() => void handleSave()}
        />
      }
    >
      <View style={styles.fields}>
        <PinBoxes
          label={t('auth.devicePin.pin')}
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError(null);
          }}
          error={pinError}
          autoFocus
        />
        <PinBoxes
          label={t('auth.devicePin.confirmPin')}
          value={confirmPin}
          onChange={(value) => {
            setConfirmPin(value);
            if (confirmError) setConfirmError(null);
          }}
          invalid={Boolean(confirmError) && confirmPin.length === 0}
          error={confirmError}
          shakeKey={shakeKey}
          onSubmit={() => void handleSave()}
        />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Hint icon="lock">{t('auth.devicePin.note')}</Hint>
      {pendingOwner.owner.email ? <Hint icon="mail">{pendingOwner.owner.email}</Hint> : null}
      <View style={styles.cancel}>
        <TextLink label={t('common.cancel')} onPress={backToEmail} />
      </View>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
  cancel: { alignItems: 'center' },
});
