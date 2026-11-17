import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Field, Screen } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  formatPhone,
  normalisePin,
  validatePinReset,
  type PinResetErrorCode,
} from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, typeScale } from '@/theme/tokens';

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

    const errors = validatePinReset({ code, pin, confirmPin });
    if (errors.length > 0) {
      setError(errors.map((item) => t(RESET_ERROR_KEYS[item])).join(' '));
      return;
    }

    setSubmitting(true);
    try {
      await resetPin({ code, pin });
      router.replace('/');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title={t('auth.reset.title')}
      subtitle={phone || undefined}
      footer={
        stage === 'confirm' ? (
          <Button
            label={submitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
            disabled={submitting || requesting}
            onPress={handleReset}
          />
        ) : undefined
      }
    >
      {stage === 'request' ? (
        <>
          <Card>
            <Text style={styles.body}>{t('auth.reset.requestBody', { phone })}</Text>
          </Card>
          <Button
            label={requesting ? t('auth.reset.sending') : t('auth.reset.request')}
            disabled={requesting}
            onPress={handleRequest}
          />
          <Text style={styles.muted}>{t('auth.reset.offlineNote')}</Text>
          <Button
            label={t('auth.reset.backToSignIn')}
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        </>
      ) : (
        <>
          {info ? <Text style={styles.info}>{info}</Text> : null}

          {demoCode ? (
            <Card style={styles.demoCard}>
              <Text style={styles.demoLabel}>{t('auth.reset.demoCode', { code: demoCode })}</Text>
              <Text style={styles.muted}>{t('auth.reset.demoNote')}</Text>
            </Card>
          ) : null}

          <Card>
            <Field
              label={t('auth.reset.code')}
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
              placeholder="123456"
              keyboardType="numeric"
              maxLength={6}
              autoFocus
              required
            />
            <Field
              label={t('auth.reset.newPin')}
              value={pin}
              onChangeText={(value) => setPin(normalisePin(value))}
              placeholder="••••"
              keyboardType="numeric"
              secureTextEntry
              maxLength={MAX_PIN_LENGTH}
              required
            />
            <Field
              label={t('auth.reset.confirmPin')}
              value={confirmPin}
              onChangeText={(value) => setConfirmPin(normalisePin(value))}
              placeholder="••••"
              keyboardType="numeric"
              secureTextEntry
              maxLength={MAX_PIN_LENGTH}
              required
            />
          </Card>

          <Button
            label={t('auth.reset.resend')}
            variant="secondary"
            disabled={requesting || submitting}
            onPress={handleRequest}
          />
          <Button
            label={t('auth.reset.backToSignIn')}
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: typeScale.body, color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  info: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  demoCard: { backgroundColor: colors.warningSoft },
  demoLabel: { fontSize: typeScale.body, color: colors.text, fontWeight: '700' },
});
