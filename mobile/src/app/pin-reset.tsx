import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice, PinBoxes } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import {
  formatPhone,
  validatePinReset,
  type PinResetErrorCode,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const RESET_ERROR_KEYS: Record<PinResetErrorCode, string> = {
  'code-invalid': 'auth.reset.error.codeInvalid',
  'pin-invalid': 'auth.reset.error.pinInvalid',
  'pin-mismatch': 'auth.reset.error.pinMismatch',
};

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.reset.error.offline',
  'phone-not-found': 'auth.reset.error.phoneNotFound',
  'invalid-code': 'auth.reset.error.invalidCode',
  'expired-code': 'auth.reset.error.expiredCode',
  'too-many-attempts': 'auth.reset.error.tooManyAttempts',
  validation: 'auth.reset.error.validation',
  server: 'auth.reset.error.server',
};

export default function PinResetScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { ownerPreview, requestPinResetCode, resetPin } = useAuth();

  const [stage, setStage] = useState<'request' | 'confirm'>('request');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const phone = ownerPreview ? formatPhone(ownerPreview.phone) : '';

  function describeError(cause: unknown): string {
    if (cause instanceof ApiError) {
      return t(API_ERROR_KEYS[cause.code] ?? 'auth.reset.error.server');
    }
    return cause instanceof Error ? cause.message : t('auth.reset.error.server');
  }

  async function handleRequest() {
    if (requesting || submitting) return;
    setError(null);
    setInfo(null);
    setRequesting(true);
    try {
      const result = await requestPinResetCode();
      setDemoCode(result.demoCode ?? null);
      setCode('');
      setStage('confirm');
      setInfo(t('auth.reset.sent'));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setRequesting(false);
    }
  }

  async function handleReset() {
    if (submitting || requesting) return;
    setError(null);
    setCodeError(null);
    setPinError(null);
    setConfirmError(null);

    const errors = validatePinReset({ code, pin, confirmPin });
    if (errors.length > 0) {
      for (const item of errors) {
        const message = t(RESET_ERROR_KEYS[item]);
        if (item === 'code-invalid') setCodeError(message);
        else if (item === 'pin-invalid') setPinError(message);
        else setConfirmError(message);
      }
      return;
    }

    setSubmitting(true);
    try {
      await resetPin({ code, pin });
      router.replace('/');
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'invalid-code' || cause.code === 'expired-code')) {
        setCodeError(describeError(cause));
      } else {
        setError(describeError(cause));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SetupStep
      eyebrow={t('auth.reset.eyebrow')}
      title={t('auth.reset.title')}
      subtitle={phone ? t('auth.reset.subtitle', { phone }) : undefined}
      onBack={() => router.replace('/sign-in')}
      backLabel={t('auth.reset.backToSignIn')}
      footer={
        stage === 'confirm' ? (
          <Button
            label={submitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
            loading={submitting}
            disabled={submitting || requesting || code.length < 6 || pin.length < 4 || confirmPin.length < 4}
            onPress={handleReset}
          />
        ) : (
          <Button
            label={requesting ? t('auth.reset.sending') : t('auth.reset.request')}
            loading={requesting}
            disabled={requesting}
            onPress={handleRequest}
          />
        )
      }
    >
      {stage === 'request' ? (
        <>
          <Notice tone="info">{t('auth.reset.requestBody', { phone })}</Notice>
          <Hint icon="wifi">{t('auth.reset.offlineNote')}</Hint>
        </>
      ) : (
        <>
          {info ? <Notice tone="success">{info}</Notice> : null}

          {demoCode ? (
            <Notice tone="warning">
              {`${t('auth.reset.demoCode', { code: demoCode })}\n${t('auth.reset.demoNote')}`}
            </Notice>
          ) : null}

          <View style={styles.fields}>
            <Field
              label={t('auth.reset.code')}
              value={code}
              onChangeText={(value) => {
                setCode(value.replace(/\D/g, ''));
                if (codeError) setCodeError(null);
              }}
              error={codeError}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123456"
              keyboardType="numeric"
              icon="sms"
              maxLength={6}
              autoFocus
              required
            />
            <PinBoxes
              label={t('auth.reset.newPin')}
              value={pin}
              onChange={(value) => {
                setPin(value);
                if (pinError) setPinError(null);
              }}
              error={pinError}
            />
            <PinBoxes
              label={t('auth.reset.confirmPin')}
              value={confirmPin}
              onChange={(value) => {
                setConfirmPin(value);
                if (confirmError) setConfirmError(null);
              }}
              error={confirmError}
              onSubmit={handleReset}
            />
          </View>

          <View style={styles.resend}>
            <TextLink
              accent
              lead={t('auth.reset.noCode')}
              label={t('auth.reset.resend')}
              onPress={handleRequest}
            />
          </View>
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
  resend: { alignItems: 'center' },
});
