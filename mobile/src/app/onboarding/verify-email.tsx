import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice } from '@/components/auth';
import { SETUP_STEPS, SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import { isValidEmail } from '@/core';
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

const CHANGE_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'verify.offline',
  'duplicate-email': 'verify.change.taken',
  validation: 'verify.change.invalid',
  unauthorized: 'verify.change.signIn',
};

/**
 * The second step of creating an account: type the 6-digit code emailed at
 * sign-up. Until then the account is not finished, so an owner who has been
 * through this screen never meets a code prompt at sign-in again. A mistyped
 * address can be fixed here; the new code then goes to the new address.
 */
export default function VerifyEmailScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { emailPending, ownerPreview, confirmOwnerEmail, requestOwnerEmailCode, changeOwnerEmail } =
    useAuth();
  const email = emailPending?.email ?? ownerPreview?.email ?? '';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'resend' | 'change' | null>(null);
  // 'none' means the first email could not be sent, so the owner must ask again.
  const [mail, setMail] = useState<'first' | 'again' | 'none'>(emailPending?.sent === false ? 'none' : 'first');
  const [error, setError] = useState<string | null>(null);
  // Set while the owner is typing a corrected address.
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

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

  function startChange() {
    setNewEmail(email);
    setEmailError(null);
    setError(null);
  }

  function cancelChange() {
    setNewEmail(null);
    setEmailError(null);
  }

  async function sendToNewEmail() {
    if (busy || newEmail === null) return;
    const next = newEmail.trim().toLowerCase();
    if (!isValidEmail(next)) {
      setEmailError(t('verify.change.invalid'));
      return;
    }
    setBusy('change');
    setEmailError(null);
    try {
      const result = await changeOwnerEmail(next);
      setMail(result.verificationSent ? 'again' : 'none');
      setCode('');
      setNewEmail(null);
    } catch (cause) {
      const key = cause instanceof ApiError ? CHANGE_ERROR_KEYS[cause.code] : undefined;
      setEmailError(t(key ?? 'verify.failed'));
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

  if (newEmail !== null) {
    return (
      <SetupStep
        step={SETUP_STEPS.verify}
        eyebrow={t('verify.eyebrow')}
        title={t('verify.title')}
        subtitle={t('verify.subtitle')}
        contentKey="change-email"
        footer={
          <Button
            label={t('verify.change.send')}
            loading={busy === 'change'}
            disabled={busy !== null || newEmail.trim().length === 0}
            onPress={() => void sendToNewEmail()}
          />
        }
      >
        <View style={styles.fields}>
          <Field
            label={t('verify.change.label')}
            value={newEmail}
            onChangeText={(value) => {
              setNewEmail(value);
              if (emailError) setEmailError(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            icon="mail"
            error={emailError}
            autoFocus
            required
          />
        </View>
        <View style={styles.center}>
          <TextLink label={t('common.cancel')} onPress={cancelChange} />
        </View>
      </SetupStep>
    );
  }

  return (
    <SetupStep
      step={SETUP_STEPS.verify}
      eyebrow={t('verify.eyebrow')}
      title={t('verify.title')}
      subtitle={t('verify.subtitle')}
      footer={
        <Button
          label={busy === 'confirm' ? t('auth.code.checking') : t('verify.confirm')}
          loading={busy === 'confirm'}
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
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          icon="mail"
          maxLength={6}
          autoFocus
          required
        />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.links}>
        <TextLink
          accent
          label={busy === 'resend' ? t('verify.sending') : t('verify.resend')}
          onPress={() => void resend()}
        />
        <TextLink accent label={t('verify.change.link')} onPress={startChange} />
      </View>
      <Hint icon="info">{t('verify.once')}</Hint>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  center: { alignItems: 'center' },
  links: { alignItems: 'center', gap: spacing.sm },
});
