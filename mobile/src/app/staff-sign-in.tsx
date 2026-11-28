import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { StaffWrongShopError, useAuth } from '@/auth/session';
import { Hint, Notice, PinBoxes } from '@/components/auth';
import { SetupStep } from '@/components/onboarding';
import { Button, Field } from '@/components/ui';
import { isValidPhone, isValidPin, normalisePhone } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'staff.signIn.error.offline',
  'phone-not-found': 'staff.signIn.error.notStaff',
  unauthorized: 'staff.signIn.error.wrongPin',
  'too-many-attempts': 'staff.signIn.error.tooMany',
  validation: 'staff.signIn.error.validation',
  server: 'staff.signIn.error.server',
};

export default function StaffSignInScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signInStaff, staffPinChange, cancelStaffPinChange } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  // Second step: the owner's PIN was one-time, so the staff member picks their own.
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [newPinError, setNewPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const phoneRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function handleSignIn() {
    if (submitting) return;
    setError(null);
    setPhoneError(null);
    setPinError(null);

    if (!isValidPhone(phone)) {
      setPhoneError(t('staff.signIn.error.phoneInvalid'));
      phoneRef.current?.focus();
      return;
    }
    if (!isValidPin(pin)) {
      setPinError(t('staff.signIn.error.pinInvalid'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await signInStaff({ phone: normalisePhone(phone), pin });
      if (result === 'ok') router.replace('/');
    } catch (cause) {
      showError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChoosePin() {
    if (submitting || !staffPinChange) return;
    setError(null);
    setNewPinError(null);
    setConfirmError(null);
    if (!isValidPin(newPin)) {
      setNewPinError(t('staff.signIn.error.pinInvalid'));
      return;
    }
    if (newPin !== confirmPin) {
      setConfirmError(t('staff.choosePin.error.mismatch'));
      setConfirmPin('');
      setShakeKey((key) => key + 1);
      return;
    }
    if (newPin === staffPinChange.pin) {
      setNewPinError(t('staff.choosePin.error.same'));
      setNewPin('');
      setConfirmPin('');
      return;
    }

    setSubmitting(true);
    try {
      await signInStaff({ phone: staffPinChange.phone, pin: staffPinChange.pin, newPin });
      router.replace('/');
    } catch (cause) {
      showError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  function showError(cause: unknown) {
    if (cause instanceof ApiError) {
      if (cause.code === 'unauthorized') {
        setPinError(t('staff.signIn.error.wrongPin'));
        setShakeKey((key) => key + 1);
        setPin('');
      } else {
        setError(t(ERROR_KEYS[cause.code] ?? 'staff.signIn.error.server'));
      }
    } else if (cause instanceof StaffWrongShopError) {
      setError(t('staff.signIn.error.wrongShop', { owner: cause.otherOwnerName }));
    } else {
      setError(cause instanceof Error ? cause.message : t('staff.signIn.error.server'));
    }
  }

  if (staffPinChange) {
    return (
      <SetupStep
        eyebrow={t('staff.signIn.eyebrow')}
        title={t('staff.choosePin.title')}
        subtitle={t('staff.choosePin.subtitle', { name: staffPinChange.name })}
        onBack={() => {
          cancelStaffPinChange();
          router.back();
        }}
        backLabel={t('common.back')}
        footer={
          <Button
            label={submitting ? t('staff.signIn.submitting') : t('staff.choosePin.action')}
            disabled={submitting || newPin.length < 4 || confirmPin.length < 4}
            loading={submitting}
            onPress={() => void handleChoosePin()}
          />
        }
      >
        <View style={styles.fields}>
          <PinBoxes
            label={t('staff.choosePin.newPin')}
            value={newPin}
            onChange={(value) => {
              setNewPin(value);
              if (error) setError(null);
              if (newPinError) setNewPinError(null);
            }}
            error={newPinError}
            invalid={Boolean(newPinError)}
          />
          <PinBoxes
            label={t('staff.choosePin.confirmPin')}
            value={confirmPin}
            onChange={(value) => {
              setConfirmPin(value);
              if (error) setError(null);
              if (confirmError) setConfirmError(null);
            }}
            error={confirmError}
            invalid={Boolean(confirmError)}
            shakeKey={shakeKey}
            onSubmit={() => void handleChoosePin()}
          />
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Hint icon="lock">{t('staff.choosePin.hint')}</Hint>
      </SetupStep>
    );
  }

  return (
    <SetupStep
      eyebrow={t('staff.signIn.eyebrow')}
      title={t('staff.signIn.title')}
      subtitle={t('staff.signIn.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        <Button
          label={submitting ? t('staff.signIn.submitting') : t('staff.signIn.action')}
          disabled={submitting || phone.trim() === '' || pin.length < 4}
          loading={submitting}
          onPress={() => void handleSignIn()}
        />
      }
    >
      <View style={styles.fields}>
        <Field
          label={t('staff.phone')}
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            if (phoneError) setPhoneError(null);
          }}
          error={phoneError}
          inputRef={phoneRef}
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="96 555 1122"
          keyboardType="phone-pad"
          prefix="+260"
          autoFocus
          required
        />
        <PinBoxes
          label={t('auth.signIn.pin')}
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error) setError(null);
            if (pinError) setPinError(null);
          }}
          error={pinError}
          invalid={Boolean(pinError)}
          shakeKey={shakeKey}
          onSubmit={() => void handleSignIn()}
        />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Hint icon="wifi">{t('staff.signIn.offlineNote')}</Hint>
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
});
