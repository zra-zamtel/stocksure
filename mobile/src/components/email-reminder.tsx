import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { readEmailPending } from '@/lib/email-verify-store';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { Notice } from './auth';
import { Button, Field, TextLink } from './ui';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'verify.offline',
  'invalid-code': 'auth.code.error.invalid',
  'expired-code': 'auth.code.error.expired',
  'too-many-attempts': 'auth.code.error.tooMany',
  validation: 'auth.code.error.invalid',
};

/**
 * "Confirm your email" box shown after sign-up until the owner types the
 * 6-digit code we emailed. It names the address and offers to send a new code,
 * since a first email can land in spam or fail to send.
 */
export function EmailReminder() {
  const { t } = useI18n();
  const { confirmOwnerEmail, ownerPreview, requestOwnerEmailCode, user } = useAuth();
  const [pending] = useState(readEmailPending);
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'checking' | 'confirmed'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!pending || user?.role !== 'owner') return null;
  if (state === 'confirmed') return <Notice tone="success">{t('verify.confirmed')}</Notice>;

  async function resend() {
    if (!pending || state === 'sending' || state === 'checking') return;
    setState('sending');
    setError(null);
    try {
      await requestOwnerEmailCode(pending.email, ownerPreview?.phone);
      setState('sent');
    } catch {
      setState('idle');
      setError(t('verify.failed'));
    }
  }

  async function confirm() {
    if (!pending || code.length !== 6 || state === 'checking') return;
    setState('checking');
    setError(null);
    try {
      await confirmOwnerEmail({ email: pending.email, code });
      setState('confirmed');
    } catch (cause) {
      setState('idle');
      const key = cause instanceof ApiError ? ERROR_KEYS[cause.code] : undefined;
      setError(t(key ?? 'verify.failed'));
    }
  }

  const message =
    state === 'sent'
      ? t('verify.resent', { email: pending.email })
      : pending.sent
        ? t('verify.sent', { email: pending.email })
        : t('verify.notSent', { email: pending.email });

  return (
    <Notice
      tone={!pending.sent && state === 'idle' ? 'warning' : 'info'}
      action={
        <View style={styles.body}>
          <Field
            label={t('auth.code.label')}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
            placeholder="123456"
            keyboardType="numeric"
            maxLength={6}
          />
          <Button
            label={state === 'checking' ? t('auth.code.checking') : t('verify.confirm')}
            disabled={code.length !== 6 || state === 'checking'}
            onPress={() => void confirm()}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <TextLink
            accent
            label={state === 'sending' ? t('verify.sending') : t('verify.resend')}
            onPress={() => void resend()}
          />
        </View>
      }
    >
      {message}
    </Notice>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, marginTop: 12, alignItems: 'stretch' },
});
