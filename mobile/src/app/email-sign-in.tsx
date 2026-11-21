import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Hint, Notice } from '@/components/auth';
import { Toggle } from '@/components/charts';
import { SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import { isValidEmail, isValidPhone, normalisePhone } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.email.error.offline',
  'invalid-credentials': 'auth.email.error.invalidCredentials',
  'email-unverified': 'auth.email.error.emailUnverified',
  validation: 'auth.email.error.validation',
  server: 'auth.email.error.server',
};

type Mode = 'password' | 'link';

/** The phone field shows +260 in front, so it holds the nine local digits. */
function localDigits(phone: string | undefined): string {
  if (!phone) return '';
  const normalised = normalisePhone(phone);
  return /^0\d{9}$/.test(normalised) ? normalised.slice(1) : phone;
}

export default function EmailSignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { beginOwnerLogin, ownerPreview, requestOwnerMagicLink } = useAuth();

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(ownerPreview?.email ?? '');
  const [password, setPassword] = useState('');
  // The phone is only required while the email is unverified. Prefill it when
  // this phone already has the owner, which covers the normal verification
  // flow; on a brand-new phone the owner types it once.
  const [phone, setPhone] = useState(localDigits(ownerPreview?.phone));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  // Set when a password sign-in found the email unverified and the server
  // emailed a verification link instead. Opening that link signs the owner in.
  const [verifySentTo, setVerifySentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [magicSending, setMagicSending] = useState(false);

  const busy = submitting || magicSending;
  const reveal = { show: t('common.showTyped'), hide: t('common.hideTyped') };

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setVerifySentTo(null);
  }

  function describe(cause: unknown): string {
    if (cause instanceof ApiError) {
      return t(API_ERROR_KEYS[cause.code] ?? 'auth.email.error.server');
    }
    return cause instanceof Error ? cause.message : t('auth.email.error.server');
  }

  function checkEmail(): boolean {
    if (!isValidEmail(email)) {
      setError(t('auth.email.error.emailInvalid'));
      return false;
    }
    return true;
  }

  async function handlePasswordSignIn() {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!checkEmail()) return;
    if (!password) {
      setError(t('auth.email.error.passwordRequired'));
      return;
    }

    setSubmitting(true);
    setVerifySentTo(null);
    setDemoToken(null);
    try {
      await beginOwnerLogin({ email, password });
      router.replace('/set-phone-pin');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'email-unverified') {
        if (cause.details.verificationSent) {
          setVerifySentTo(email.trim().toLowerCase());
          setDemoToken(cause.details.demoToken ?? null);
        } else {
          setError(t('auth.email.error.verifyNotSent'));
        }
      } else {
        setError(describe(cause));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicLink() {
    if (busy) return;
    setError(null);
    setInfo(null);
    setDemoToken(null);
    if (!checkEmail()) return;
    const accountPhone = phone.trim() || ownerPreview?.phone || '';
    if (!accountPhone) {
      setError(t('auth.email.error.phoneRequired'));
      return;
    }
    if (!isValidPhone(accountPhone)) {
      setError(t('auth.email.error.phoneInvalid'));
      return;
    }

    setMagicSending(true);
    try {
      const result = await requestOwnerMagicLink(email, normalisePhone(accountPhone));
      setInfo(t('auth.email.magicSent'));
      setDemoToken(result.demoToken ?? null);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setMagicSending(false);
    }
  }

  function handlePastedLink() {
    setError(null);
    const trimmed = pastedLink.trim();
    if (!trimmed) {
      setError(t('auth.email.error.pasteInvalid'));
      return;
    }

    const match = trimmed.match(/[?&]token=([^&\s]+)/);
    let token = trimmed;
    if (match) {
      try {
        token = decodeURIComponent(match[1]);
      } catch {
        token = match[1];
      }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      setError(t('auth.email.error.pasteInvalid'));
      return;
    }

    router.push({ pathname: '/magic-link', params: { token } });
  }

  const footer =
    mode === 'password' ? (
      <Button
        label={submitting ? t('auth.email.signingIn') : t('auth.email.action')}
        disabled={busy || email.trim() === '' || password === ''}
        onPress={() => void handlePasswordSignIn()}
      />
    ) : (
      <Button
        label={magicSending ? t('auth.email.sendingLink') : t('auth.email.magicAction')}
        disabled={busy || email.trim() === ''}
        onPress={() => void handleMagicLink()}
      />
    );

  return (
    <SetupStep
      eyebrow={t('auth.email.eyebrow')}
      title={t('auth.email.title')}
      subtitle={t('auth.email.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={footer}
    >
      <Toggle
        options={[
          { value: 'password' as Mode, label: t('auth.email.modePassword') },
          { value: 'link' as Mode, label: t('auth.email.modeLink') },
        ]}
        value={mode}
        onChange={switchMode}
      />

      <View style={styles.fields}>
        <Field
          label={t('auth.email.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          icon="mail"
          required
        />
        {mode === 'password' ? (
          <Field
            label={t('auth.email.password')}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            icon="lock"
            secureTextEntry
            revealLabels={reveal}
            required
          />
        ) : (
          <>
            <Field
              label={t('auth.email.phone')}
              value={phone}
              onChangeText={setPhone}
              placeholder="97 123 4567"
              keyboardType="phone-pad"
              prefix="🇿🇲 +260"
            />
            <Hint icon="info">{t('auth.email.phoneHint')}</Hint>
          </>
        )}
      </View>

      {mode === 'password' ? (
        <View style={styles.forgot}>
          <TextLink accent label={t('auth.email.forgotPassword')} onPress={() => switchMode('link')} />
        </View>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === 'password' && verifySentTo ? (
        <Notice tone="success">{t('auth.email.verifySent', { email: verifySentTo })}</Notice>
      ) : null}

      {mode === 'link' || verifySentTo ? (
        <>
          {mode === 'link' && info ? <Notice tone="success">{info}</Notice> : null}

          {demoToken ? (
            <Notice
              tone="warning"
              action={
                <Button
                  label={t('auth.email.openDemoLink')}
                  onPress={() =>
                    router.push({
                      pathname: '/magic-link',
                      params: { token: demoToken },
                    })
                  }
                />
              }
            >
              {t('auth.email.demoNote')}
            </Notice>
          ) : null}

          {!showPaste ? (
            <View style={styles.center}>
              <TextLink
                lead={t('auth.email.haveLink')}
                label={t('auth.email.pasteIt')}
                accent
                onPress={() => setShowPaste(true)}
              />
            </View>
          ) : (
            <View style={styles.fields}>
              <Field
                label={t('auth.email.pasteLabel')}
                value={pastedLink}
                onChangeText={setPastedLink}
                placeholder={t('auth.email.pastePlaceholder')}
                autoCapitalize="none"
                icon="link"
              />
              <Hint icon="info">{t('auth.email.pasteHint')}</Hint>
              <Button
                label={t('auth.email.pasteAction')}
                variant="secondary"
                disabled={pastedLink.trim() === ''}
                onPress={handlePastedLink}
              />
            </View>
          )}
        </>
      ) : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  forgot: { alignItems: 'flex-end', marginTop: -spacing.sm },
  center: { alignItems: 'center' },
});
