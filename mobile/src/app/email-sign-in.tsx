import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import { isValidEmail } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.email.error.offline',
  'invalid-credentials': 'auth.email.error.invalidCredentials',
  'invalid-code': 'auth.code.error.invalid',
  'expired-code': 'auth.code.error.expired',
  'too-many-attempts': 'auth.code.error.tooMany',
  validation: 'auth.email.error.validation',
  server: 'auth.email.error.server',
};

/**
 * - password: email + password.
 * - confirm: the password was right but the email is unconfirmed; the server
 *   emailed a 6-digit code, and entering it signs the owner in.
 * - reset: forgot password; email a code, then set a new password with it.
 */
type Step = 'password' | 'confirm' | 'reset-request' | 'reset-confirm';

const MIN_PASSWORD = 8;

export default function EmailSignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const {
    beginOwnerLogin,
    beginOwnerEmailCode,
    beginOwnerPasswordReset,
    ownerPreview,
    requestOwnerPasswordReset,
  } = useAuth();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState(ownerPreview?.email ?? '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = { show: t('common.showTyped'), hide: t('common.hideTyped') };
  const cleanEmail = email.trim().toLowerCase();

  function goTo(next: Step) {
    setStep(next);
    setError(null);
    setEmailError(null);
    setPasswordError(null);
    setNewPasswordError(null);
    setCodeError(null);
    setInfo(null);
    setDemoCode(null);
    setCode('');
  }

  function describe(cause: unknown): string {
    if (cause instanceof ApiError) {
      return t(API_ERROR_KEYS[cause.code] ?? 'auth.email.error.server');
    }
    return cause instanceof Error ? cause.message : t('auth.email.error.server');
  }

  function checkEmail(): boolean {
    if (!isValidEmail(email)) {
      setEmailError(t('auth.email.error.emailInvalid'));
      return false;
    }
    return true;
  }

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setError(null);
    setCodeError(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'invalid-code' || cause.code === 'expired-code')) {
        setCodeError(describe(cause));
      } else {
        setError(describe(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  function handlePasswordSignIn() {
    if (!checkEmail()) return;
    if (!password) {
      setPasswordError(t('auth.email.error.passwordRequired'));
      return;
    }
    void run(async () => {
      try {
        await beginOwnerLogin({ email, password });
        router.replace('/set-phone-pin');
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== 'email-unverified') throw cause;
        if (!cause.details.verificationSent) {
          setError(t('auth.email.error.verifyNotSent'));
          return;
        }
        // Re-entering the password sends a fresh code, so "resend" reuses this.
        goTo('confirm');
        setInfo(t('auth.code.sentConfirm', { email: cleanEmail }));
        setDemoCode(cause.details.demoCode ?? null);
      }
    });
  }

  function handleConfirmCode() {
    void run(async () => {
      await beginOwnerEmailCode({ email, code });
      router.replace('/set-phone-pin');
    });
  }

  function handleResetRequest() {
    if (!checkEmail()) return;
    void run(async () => {
      const result = await requestOwnerPasswordReset(email);
      goTo('reset-confirm');
      setInfo(t('auth.code.sentReset', { email: cleanEmail }));
      setDemoCode(result.demoCode ?? null);
    });
  }

  function handleResetConfirm() {
    if (newPassword.length < MIN_PASSWORD) {
      setNewPasswordError(t('auth.code.error.passwordShort'));
      return;
    }
    void run(async () => {
      await beginOwnerPasswordReset({ email, code, password: newPassword });
      router.replace('/set-phone-pin');
    });
  }

  const codeReady = code.length === 6;
  const footer = {
    password: (
      <Button
        label={busy ? t('auth.email.signingIn') : t('auth.email.action')}
        loading={busy}
        disabled={busy || email.trim() === '' || password === ''}
        onPress={handlePasswordSignIn}
      />
    ),
    confirm: (
      <Button
        label={busy ? t('auth.code.checking') : t('auth.code.confirmAction')}
        loading={busy}
        disabled={busy || !codeReady}
        onPress={handleConfirmCode}
      />
    ),
    'reset-request': (
      <Button
        label={busy ? t('auth.code.sending') : t('auth.code.sendReset')}
        loading={busy}
        disabled={busy || email.trim() === ''}
        onPress={handleResetRequest}
      />
    ),
    'reset-confirm': (
      <Button
        label={busy ? t('auth.code.checking') : t('auth.code.resetAction')}
        loading={busy}
        disabled={busy || !codeReady || newPassword === ''}
        onPress={handleResetConfirm}
      />
    ),
  }[step];

  const resetting = step === 'reset-request' || step === 'reset-confirm';

  const codeField = (
    <Field
      label={t('auth.code.label')}
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
      icon="mail"
      maxLength={6}
      autoFocus
      required
    />
  );

  return (
    <SetupStep
      eyebrow={t('auth.email.eyebrow')}
      title={resetting ? t('auth.code.resetTitle') : t('auth.email.title')}
      subtitle={resetting ? t('auth.code.resetSubtitle') : t('auth.email.subtitle')}
      onBack={() => (step === 'password' ? router.back() : goTo('password'))}
      backLabel={t('common.back')}
      footer={footer}
    >
      {info ? <Notice tone="success">{info}</Notice> : null}

      {demoCode ? (
        <Notice tone="warning">
          {`${t('auth.reset.demoCode', { code: demoCode })}\n${t('auth.code.demoNote')}`}
        </Notice>
      ) : null}

      <View style={styles.fields}>
        {step === 'password' || step === 'reset-request' ? (
          <Field
            label={t('auth.email.email')}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (emailError) setEmailError(null);
            }}
            error={emailError}
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@example.com"
            keyboardType="email-address"
            icon="mail"
            required
          />
        ) : null}

        {step === 'password' ? (
          <Field
            label={t('auth.email.password')}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
            }}
            error={passwordError}
            autoComplete="current-password"
            textContentType="password"
            placeholder="••••••••"
            icon="lock"
            secureTextEntry
            revealLabels={reveal}
            required
          />
        ) : null}

        {step === 'confirm' || step === 'reset-confirm' ? codeField : null}

        {step === 'reset-confirm' ? (
          <Field
            label={t('auth.code.newPassword')}
            value={newPassword}
            onChangeText={(value) => {
              setNewPassword(value);
              if (newPasswordError) setNewPasswordError(null);
            }}
            error={newPasswordError}
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="••••••••"
            icon="lock"
            secureTextEntry
            revealLabels={reveal}
            required
          />
        ) : null}
      </View>

      {step === 'password' ? (
        <View style={styles.end}>
          <TextLink accent label={t('auth.email.forgotPassword')} onPress={() => goTo('reset-request')} />
        </View>
      ) : null}

      {step === 'confirm' || step === 'reset-confirm' ? (
        <View style={styles.center}>
          <TextLink
            accent
            lead={t('auth.reset.noCode')}
            label={t('auth.reset.resend')}
            onPress={step === 'confirm' ? handlePasswordSignIn : handleResetRequest}
          />
        </View>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  end: { alignItems: 'flex-end', marginTop: -spacing.sm },
  center: { alignItems: 'center' },
});
