import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Field, Screen } from '@/components/ui';
import { MAX_PIN_LENGTH, normalisePin } from '@/core';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

export default function SignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { ownerPreview, signIn, onboardingComplete, hasOwner, shopRestorePending } = useAuth();  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn(pin);
      if (result === 'wrong-pin') {
        setError(t('auth.signIn.wrongPin'));
        setPin('');
        return;
      }
      if (result === 'no-account') {
        setError(t('auth.signIn.noOwner'));
        return;
      }
      if (result === 'ambiguous-pin') {
        setError(t('auth.signIn.ambiguousPin'));
        return;
      }
      if (result === 'first-sign-in-offline') {
        setError(t('auth.signIn.firstSignInOffline'));
        return;
      }
      if (result === 'locked-out') {
        setError(t('auth.signIn.lockedOut'));
        return;
      }
      // The index gate sends a finished shop to the tabs and an unfinished one
      // back to the setup screen it stopped on.
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('auth.signIn.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title={ownerPreview ? `${t('auth.signIn.title')}, ${ownerPreview.name}` : t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      footer={
        <Button
          label={t('auth.signIn.action')}
          disabled={pin.length < 4 || submitting}
          onPress={handleSignIn}
        />
      }
    >
      <Card>
        <Field
          label={t('auth.signIn.pin')}
          value={pin}
          onChangeText={(value) => setPin(normalisePin(value))}
          placeholder="••••"
          keyboardType="numeric"
          secureTextEntry
          maxLength={MAX_PIN_LENGTH}
          autoFocus
        />
      </Card>

      <Button
        label={t('auth.signIn.emailSignIn')}
        variant="secondary"
        onPress={() => router.push('/email-sign-in')}
      />

      <Button
        label={t('auth.signIn.staffNewPhone')}
        variant="secondary"
        onPress={() => router.push('/staff-sign-in')}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hasOwner && !onboardingComplete && !shopRestorePending ? (
        <Text style={styles.muted}>{t('auth.signIn.setupContinues')}</Text>
      ) : null}
      <Text style={styles.muted}>{t('auth.signIn.offlineNote')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
