import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Avatar, displayName, Hint, Notice, OptionRow, PinBoxes, SectionDivider } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, TextLink } from '@/components/ui';
import { useI18n } from '@/i18n';
import { spacing } from '@/theme/tokens';

export default function SignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { ownerPreview, signIn, onboardingComplete, hasOwner, shopRestorePending } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (submitting || pin.length < 4) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn(pin);
      if (result === 'wrong-pin') {
        setError(t('auth.signIn.wrongPin'));
        setShakeKey((key) => key + 1);
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

  const name = ownerPreview ? displayName(ownerPreview.name) : null;

  return (
    <SetupStep
      eyebrow={t('auth.signIn.title')}
      title={name ?? t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      hero={name ? <Avatar name={name} /> : undefined}
      footer={
        <Button
          label={t('auth.signIn.action')}
          disabled={pin.length < 4 || submitting}
          onPress={() => void handleSignIn()}
        />
      }
    >
      <View style={styles.pinBlock}>
        <PinBoxes
          label={t('auth.signIn.pin')}
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error) setError(null);
          }}
          invalid={Boolean(error) && pin.length === 0}
          shakeKey={shakeKey}
          onSubmit={() => void handleSignIn()}
          autoFocus
        />
        {hasOwner ? (
          <View style={styles.forgot}>
            <TextLink accent label={t('auth.signIn.forgotPin')} onPress={() => router.push('/pin-reset')} />
          </View>
        ) : null}
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {hasOwner && !onboardingComplete && !shopRestorePending ? (
        <Notice tone="info">{t('auth.signIn.setupContinues')}</Notice>
      ) : null}
      <Hint icon="wifi_off">{t('auth.signIn.offlineNote')}</Hint>

      <SectionDivider label={t('auth.signIn.otherWays')} />
      <View style={styles.options}>
        <OptionRow
          icon="mail"
          title={t('auth.signIn.emailOption')}
          caption={t('auth.signIn.emailOptionHint')}
          onPress={() => router.push('/email-sign-in')}
        />
        <OptionRow
          icon="badge"
          title={t('auth.signIn.staffOption')}
          caption={t('auth.signIn.staffOptionHint')}
          onPress={() => router.push('/staff-sign-in')}
        />
      </View>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  pinBlock: { gap: spacing.xs },
  forgot: { alignItems: 'flex-start', marginLeft: -spacing.sm },
  options: { gap: spacing.sm },
});
