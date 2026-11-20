import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Field, Screen } from '@/components/ui';
import { isValidEmail, isValidPhone } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, spacing, typeScale } from '@/theme/tokens';

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.email.error.offline',
  'invalid-credentials': 'auth.email.error.invalidCredentials',
  'email-unverified': 'auth.email.error.emailUnverified',
  validation: 'auth.email.error.validation',
  server: 'auth.email.error.server',
};

export default function EmailSignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { beginOwnerLogin, ownerPreview, requestOwnerMagicLink } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The phone is only required while the email is unverified. Prefill it when
  // this phone already has the owner, which covers the normal verification
  // flow; on a brand-new phone the owner types it once.
  const [phone, setPhone] = useState(ownerPreview?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [magicSending, setMagicSending] = useState(false);

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
    if (submitting || magicSending) return;
    setError(null);
    setInfo(null);
    if (!checkEmail()) return;
    if (!password) {
      setError(t('auth.email.error.passwordRequired'));
      return;
    }

    setSubmitting(true);
    try {
      await beginOwnerLogin({ email, password });
      router.replace('/set-phone-pin');
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicLink() {
    if (submitting || magicSending) return;
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
      const result = await requestOwnerMagicLink(email, accountPhone || undefined);
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

  return (
    <Screen
      title={t('auth.email.title')}
      subtitle={t('auth.email.subtitle')}
      footer={
        <Button
          label={submitting ? t('auth.email.signingIn') : t('auth.email.action')}
          disabled={submitting || magicSending || email.trim() === '' || password === ''}
          onPress={() => void handlePasswordSignIn()}
        />
      }
    >
      <Card>
        <Field
          label={t('auth.email.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="default"
          autoCapitalize="none"
          autoFocus
          required
        />
        <Field
          label={t('auth.email.password')}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          required
        />
        <Field
          label={t('auth.email.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder="097 123 4567"
          keyboardType="phone-pad"
        />
        <Text style={styles.muted}>{t('auth.email.phoneHint')}</Text>
      </Card>

      <Button
        label={magicSending ? t('auth.email.sendingLink') : t('auth.email.magicAction')}
        variant="secondary"
        disabled={submitting || magicSending || email.trim() === ''}
        onPress={() => void handleMagicLink()}
      />

      {info ? <Text style={styles.info}>{info}</Text> : null}

      <Card style={styles.pasteCard}>
        <Text style={styles.pasteTitle}>{t('auth.email.pasteTitle')}</Text>
        <Text style={styles.muted}>{t('auth.email.pasteHint')}</Text>
        <Field
          label={t('auth.email.pasteLabel')}
          value={pastedLink}
          onChangeText={setPastedLink}
          placeholder={t('auth.email.pastePlaceholder')}
          autoCapitalize="none"
        />
        <Button
          label={t('auth.email.pasteAction')}
          variant="secondary"
          disabled={pastedLink.trim() === ''}
          onPress={handlePastedLink}
        />
      </Card>

      {demoToken ? (
        <Card style={styles.demoCard}>
          <Text style={styles.demoLabel}>{t('auth.email.demoLink')}</Text>
          <Button
            label={t('auth.email.openDemoLink')}
            onPress={() =>
              router.push({ pathname: '/magic-link', params: { token: demoToken } })
            }
          />
          <Text style={styles.muted}>{t('auth.email.demoNote')}</Text>
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>{t('auth.email.pinNote')}</Text>
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  pasteCard: { gap: spacing.xs },
  pasteTitle: { fontSize: typeScale.body, color: colors.text, fontWeight: '700' },
  demoCard: { backgroundColor: colors.warningSoft, gap: spacing.xs },
  demoLabel: { fontSize: typeScale.body, color: colors.text, fontWeight: '700' },
});
