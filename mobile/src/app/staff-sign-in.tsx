import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice, PinBoxes } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, Field } from '@/components/ui';
import { isValidPhone, isValidPin, normalisePhone } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

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
  const [shakeKey, setShakeKey] = useState(0);
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
        if (cause.code === 'unauthorized') {
          setShakeKey((key) => key + 1);
          setPin('');
        }
      } else {
        setError(cause instanceof Error ? cause.message : t('staff.signIn.error.server'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SetupStep
      eyebrow={t('staff.signIn.eyebrow')}
      title={t('staff.signIn.title')}
      subtitle={t('staff.signIn.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        <Button
          label={submitting ? t('staff.signIn.submitting') : t('staff.signIn.action')}
          disabled={submitting || phone.trim() === '' || pin.length < 4}
          onPress={() => void handleSignIn()}
        />
      }
    >
      <View style={styles.fields}>
        <Field
          label={t('staff.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder="96 555 1122"
          keyboardType="phone-pad"
          prefix="🇿🇲 +260"
          autoFocus
          required
        />
        <PinBoxes
          label={t('auth.signIn.pin')}
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error) setError(null);
          }}
          invalid={Boolean(error) && pin.length === 0}
          shakeKey={shakeKey}
          onSubmit={() => void handleSignIn()}
        />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Hint icon="wifi">{t('staff.signIn.offlineNote')}</Hint>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
});
