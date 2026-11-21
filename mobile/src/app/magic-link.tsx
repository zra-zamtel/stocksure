import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.magic.error.offline',
  'invalid-token': 'auth.magic.error.invalid',
  'expired-token': 'auth.magic.error.expired',
  validation: 'auth.magic.error.invalid',
  server: 'auth.magic.error.server',
};

type Outcome = 'verifying' | 'confirmed' | 'other-account' | 'failed';

/**
 * Opened by the emailed link (or the demo button). The token is checked once.
 * - Signed out: the link signs the owner in; this phone then needs a PIN.
 * - Signed in as that owner (the usual case right after sign-up): the link
 *   only confirms the email, so go back home with no new PIN.
 * - Signed in as someone else: refuse, rather than swap accounts silently.
 */
export default function MagicLinkScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { beginOwnerMagicLink, cancelOwnerLogin, user } = useAuth();

  const [outcome, setOutcome] = useState<Outcome>(token ? 'verifying' : 'failed');
  const [error, setError] = useState<string | null>(() => (token ? null : t('auth.magic.missing')));
  const started = useRef(false);
  // Read once: who was signed in when the link arrived.
  const [signedInAs] = useState(user);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    beginOwnerMagicLink(token)
      .then((owner) => {
        const current = signedInAs;
        if (!current) {
          router.replace('/set-phone-pin');
          return;
        }
        // Already signed in on this phone: nothing to set up.
        cancelOwnerLogin();
        setOutcome(current.role === 'owner' && current.id === owner.id ? 'confirmed' : 'other-account');
      })
      .catch((cause: unknown) => {
        setOutcome('failed');
        if (cause instanceof ApiError) {
          setError(t(ERROR_KEYS[cause.code] ?? 'auth.magic.error.server'));
        } else {
          setError(cause instanceof Error ? cause.message : t('auth.magic.error.server'));
        }
      });
  }, [beginOwnerMagicLink, cancelOwnerLogin, router, signedInAs, t, token]);

  const footer =
    outcome === 'verifying' ? undefined : outcome === 'failed' && !signedInAs ? (
      <Button label={t('auth.magic.tryAgain')} onPress={() => router.replace('/email-sign-in')} />
    ) : (
      <Button label={t('auth.magic.continue')} onPress={() => router.replace('/')} />
    );

  return (
    <SetupStep
      eyebrow={t('auth.email.eyebrow')}
      title={outcome === 'confirmed' ? t('auth.magic.confirmedTitle') : t('auth.magic.title')}
      footer={footer}
    >
      {outcome === 'verifying' ? (
        <View style={styles.centred}>
          <ActivityIndicator color={colors.primary} />
          <Notice tone="info">{t('auth.magic.verifying')}</Notice>
        </View>
      ) : null}
      {outcome === 'confirmed' ? <Notice tone="success">{t('auth.magic.confirmed')}</Notice> : null}
      {outcome === 'other-account' ? <Notice tone="warning">{t('auth.magic.otherAccount')}</Notice> : null}
      {outcome === 'failed' && error ? <Notice tone="error">{error}</Notice> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  centred: { gap: spacing.md },
});
