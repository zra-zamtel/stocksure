import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Avatar, displayName, Hint, Notice, OptionRow, PinBoxes, SectionDivider } from '@/components/auth';
import { Logo, SetupStep } from '@/components/onboarding';
import { Button, TextLink } from '@/components/ui';
import { useI18n } from '@/i18n';
import { waitLabelParts, type GuardStatus } from '@/lib/pin-guard';
import { spacing } from '@/theme/tokens';

export default function SignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { ownerPreview, signIn, pinLock, onboardingComplete, hasOwner, shopRestorePending } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Too many wrong PINs lock the PIN for a while, and finally until the owner
  // signs in with email. The countdown below is for display only; every
  // attempt is checked again against the phone's own clock.
  const [lockEndsAt, setLockEndsAt] = useState<number | null>(null);
  const [onlineRequired, setOnlineRequired] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const applyLock = useCallback((status: GuardStatus) => {
    setOnlineRequired(status.requiresOnline);
    const current = Date.now();
    setNow(current);
    setLockEndsAt(status.remainingMs > 0 ? current + status.remainingMs : null);
  }, []);

  // A lock survives closing the app, so check it when the screen opens.
  useEffect(() => {
    void pinLock().then(applyLock);
  }, [pinLock, applyLock]);

  useEffect(() => {
    if (lockEndsAt === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockEndsAt) setLockEndsAt(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockEndsAt]);

  const waitMs = lockEndsAt === null ? 0 : Math.max(0, lockEndsAt - now);
  const locked = onlineRequired || waitMs > 0;
  const wait = waitLabelParts(waitMs);

  async function handleSignIn() {
    if (submitting || locked || pin.length < 4) return;
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
      if (result === 'pin-locked' || result === 'online-required') {
        applyLock(await pinLock());
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
      if (result === 'choose-pin') {
        router.push('/staff-sign-in');
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
      hero={name ? <Avatar name={name} /> : <Logo />}
      footer={
        <Button
          label={t('auth.signIn.action')}
          disabled={pin.length < 4 || submitting || locked}
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
          invalid={(Boolean(error) || locked) && pin.length === 0}
          shakeKey={shakeKey}
          onSubmit={() => void handleSignIn()}
          disabled={locked}
          autoFocus
        />
        {hasOwner ? (
          <View style={styles.forgot}>
            <TextLink accent label={t('auth.signIn.forgotPin')} onPress={() => router.push('/pin-reset')} />
          </View>
        ) : null}
      </View>

      {onlineRequired ? (
        <Notice tone="warning">{t('auth.signIn.onlineRequired')}</Notice>
      ) : waitMs > 0 ? (
        <Notice tone="warning">
          {t('auth.signIn.pinLocked', { time: t(`auth.signIn.wait.${wait.unit}`, { count: wait.count }) })}
        </Notice>
      ) : null}
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
          onPress={() => router.push('/email-sign-in')}
        />
        <OptionRow
          icon="badge"
          title={t('auth.signIn.staffOption')}
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
