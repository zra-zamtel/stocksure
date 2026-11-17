import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, spacing, typeScale } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'auth.magic.error.offline',
  'invalid-token': 'auth.magic.error.invalid',
  'expired-token': 'auth.magic.error.expired',
  validation: 'auth.magic.error.invalid',
  server: 'auth.magic.error.server',
};

/**
 * Opened by the email link, or by the demo button while EXPOSE_EMAIL_TOKEN is
 * on. The token is checked once; the phone then needs a local PIN.
 */
export default function MagicLinkScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { beginOwnerMagicLink } = useAuth();

  const [error, setError] = useState<string | null>(() =>
    token ? null : t('auth.magic.missing')
  );
  const [verifying, setVerifying] = useState(Boolean(token));
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    beginOwnerMagicLink(token)
      .then(() => router.replace('/set-phone-pin'))
      .catch((cause: unknown) => {
        if (cause instanceof ApiError) {
          setError(t(ERROR_KEYS[cause.code] ?? 'auth.magic.error.server'));
        } else {
          setError(cause instanceof Error ? cause.message : t('auth.magic.error.server'));
        }
      })
      .finally(() => setVerifying(false));
  }, [beginOwnerMagicLink, router, t, token]);

  return (
    <Screen title={t('auth.magic.title')}>
      <Card style={styles.centred}>
        {verifying ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>{t('auth.magic.verifying')}</Text>
          </>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.muted}>{t('auth.magic.done')}</Text>
        )}
      </Card>

      {!verifying ? (
        <>
          <Button
            label={t('auth.magic.tryAgain')}
            variant="secondary"
            onPress={() => router.replace('/email-sign-in')}
          />
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centred: { alignItems: 'center', gap: spacing.md },
  muted: { fontSize: typeScale.label, color: colors.textMuted, textAlign: 'center' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600', textAlign: 'center' },
});
