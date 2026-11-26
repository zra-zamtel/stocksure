import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'verify.offline',
  'invalid-code': 'auth.code.error.invalid',
  'expired-code': 'auth.code.error.expired',
  'too-many-attempts': 'auth.code.error.tooMany',
  validation: 'auth.code.error.invalid',
};

/**
 * The last step of creating an account: type the 6-digit code emailed at
 * sign-up. Until then the account is not finished, so an owner who has been
 * through this screen never meets a code prompt at sign-in again.
 */
export default function VerifyEmailScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { emailPending, ownerPreview, confirmOwnerEmail, requestOwnerEmailCode } = useAuth();
  const email = emailPending?.email ?? ownerPreview?.email ?? '';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'resend' | null>(null);
  // 'none' means the first email could not be sent, so the owner must ask again.
  const [mail, setMail] = useState<'first' | 'again' | 'none'>(emailPending?.sent === false ? 'none' : 'first');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy || code.length !== 6) return;
    setBusy('confirm');
    setError(null);
    try {
      await confirmOwnerEmail({ email, code });
      // The index gate sends the owner on to shop setup.
      router.replace('/');
    } catch (cause) {
      const key = cause instanceof ApiError ? ERROR_KEYS[cause.code] : undefined;
      setError(t(key ?? 'verify.failed'));
      setBusy(null);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy('resend');
    setError(null);
    try {
      await requestOwnerEmailCode(email, ownerPreview?.phone);
      setMail('again');
      setCode('');
    } catch (cause) {
      setError(t(cause instanceof ApiError && cause.code === 'offline' ? 'verify.offline' : 'verify.failed'));
    } finally {
      setBusy(null);
    }
  }

  const message =
    mail === 'again'
      ? t('verify.resent', { email })
      : mail === 'none'
        ? t('verify.notSent', { email })
        : t('verify.sent', { email });

  return (
    <SetupStep
      eyebrow={t('verify.eyebrow')}
      title={t('verify.title')}
      subtitle={t('verify.subtitle')}
      footer={
        <Button
          label={busy === 'confirm' ? t('auth.code.checking') : t('verify.confirm')}
          disabled={busy !== null || code.length !== 6}
          onPress={() => void confirm()}
        />
      }
    >
      <Notice tone={mail === 'none' ? 'warning' : 'info'}>{message}</Notice>

      <View style={styles.fields}>
        <Field
          label={t('auth.code.label')}
          value={code}
          onChangeText={(value) => {
            setCode(value.replace(/\D/g, ''));
            if (error) setError(null);
          }}
          placeholder="123456"
          keyboardType="numeric"
          icon="mail"
          maxLength={6}
          autoFocus
          required
        />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.center}>
        <TextLink
          accent
          label={busy === 'resend' ? t('verify.sending') : t('verify.resend')}
          onPress={() => void resend()}
        />
      </View>
      <Hint icon="info">{t('verify.once')}</Hint>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  center: { alignItems: 'center' },
});
