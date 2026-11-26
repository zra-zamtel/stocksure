import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import {
  MAX_PIN_LENGTH,
  formatPhone,
  isValidPin,
  newId,
  normalisePhone,
  normalisePin,
  validateStaffAccount,
  type AccountErrorCode,
} from '@/core';
import { useStaff } from '@/db/hooks';
import {
  createStaff,
  getOwner,
  listIdentities,
  updateStaffPinHash,
  type StaffRecord,
} from '@/db/repos';
import { useI18n } from '@/i18n';
import {
  ApiError,
  type ApiErrorCode,
  registerStaffOnServer,
  resetStaffPinOnServer,
} from '@/lib/api';
import { hashPin, verifyPin } from '@/lib/pin';
import { ConnectDevice } from '@/components/connect-device';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

const VALIDATION_KEYS: Partial<Record<AccountErrorCode, string>> = {
  'name-required': 'staff.error.nameRequired',
  'phone-invalid': 'staff.error.phoneInvalid',
  'pin-invalid': 'staff.error.pinInvalid',
  'pin-mismatch': 'staff.error.pinMismatch',
};

const API_ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'staff.error.offline',
  unauthorized: 'staff.error.signInAgain',
  forbidden: 'staff.error.ownerMismatch',
  'duplicate-phone': 'staff.error.phoneTaken',
  'staff-not-found': 'staff.error.staffNotFound',
  'owner-not-found': 'staff.error.ownerMissing',
  validation: 'staff.error.validation',
  server: 'staff.error.server',
};

export default function StaffScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const { ownerPreview, deviceToken, refresh } = useAuth();
  const { data: staff, reload } = useStaff();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when an online step found this phone not connected (no key, or the
  // server refused it). The connect panel then shows above the form, and the
  // action the owner pressed runs again once it is connected.
  const [needsConnect, setNeedsConnect] = useState(false);
  const [pendingAction, setPendingAction] = useState<'add' | 'reset' | null>(null);

  const resetPerson = staff.find((person) => person.id === resettingId) ?? null;

  function resetForm() {
    setName('');
    setPhone('');
    setPin('');
    setConfirmPin('');
    setError(null);
  }

  function resetPinForm() {
    setResettingId(null);
    setNewPin('');
    setConfirmNewPin('');
    setError(null);
  }

  function startPinReset(person: StaffRecord) {
    setAdding(false);
    resetForm();
    setMessage(null);
    setResettingId(person.id);
    setNewPin('');
    setConfirmNewPin('');
  }

  /** True when the failure means "connect this phone", which the panel handles. */
  function wantsConnect(cause: unknown, action: 'add' | 'reset'): boolean {
    if (cause instanceof ApiError && cause.code === 'unauthorized') {
      setNeedsConnect(true);
      setPendingAction(action);
      return true;
    }
    return false;
  }

  function describeApiError(cause: unknown): string {
    if (cause instanceof ApiError) {
      return t(API_ERROR_KEYS[cause.code] ?? 'staff.error.server');
    }
    return cause instanceof Error ? cause.message : t('staff.error.server');
  }

  async function handleAdd(tokenOverride?: string) {
    const token = tokenOverride ?? (needsConnect ? null : deviceToken);
    if (saving) return;
    setError(null);
    setMessage(null);

    const errors = validateStaffAccount({ name, phone, pin, confirmPin });
    if (errors.length > 0) {
      setError(errors.map((code) => t(VALIDATION_KEYS[code] ?? 'staff.error.server')).join(' '));
      return;
    }

    const owner = await getOwner(db);
    if (!owner) {
      setError(t('staff.error.ownerMissing'));
      return;
    }
    if (!token) {
      setNeedsConnect(true);
      setPendingAction('add');
      return;
    }

    const normalised = normalisePhone(phone);
    const identities = await listIdentities(db);
    if (identities.some((identity) => identity.phone === normalised)) {
      setError(t('staff.error.phoneTaken'));
      return;
    }

    // Two people on one phone must not share a PIN, or sign-in cannot tell
    // them apart. The owner knows the PIN at this point, so catch it early.
    for (const identity of identities) {
      if (await verifyPin(pin, identity.pinHash)) {
        setError(t('staff.error.pinTaken'));
        return;
      }
    }

    setSaving(true);
    try {
      const pinHash = await hashPin(pin);
      const id = newId('staff');
      await registerStaffOnServer({
        id,
        ownerId: owner.id,
        name: name.trim(),
        phone: normalised,
        pin,
        deviceToken: token,
      });
      await createStaff(db, { id, name: name.trim(), phone: normalised, pinHash });
      resetForm();
      setAdding(false);
      setMessage(t('staff.added', { name: name.trim() }));
      reload();
      // The owner stops recording sales once the shop has staff.
      void refresh();
    } catch (cause) {
      if (!wantsConnect(cause, 'add')) setError(describeApiError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPin(tokenOverride?: string) {
    const token = tokenOverride ?? (needsConnect ? null : deviceToken);
    if (saving) return;
    setError(null);
    setMessage(null);

    const person = resetPerson;
    if (!person) {
      setError(t('staff.error.staffNotFound'));
      return;
    }
    if (!isValidPin(newPin)) {
      setError(t('staff.error.pinInvalid'));
      return;
    }
    if (newPin !== confirmNewPin) {
      setError(t('staff.error.pinMismatch'));
      return;
    }
    if (!token) {
      setNeedsConnect(true);
      setPendingAction('reset');
      return;
    }

    // The new PIN must still tell this person apart from everyone else who
    // unlocks the phone. Check the other identities, not this person's old PIN.
    const identities = await listIdentities(db);
    for (const identity of identities) {
      if (identity.id !== person.id && (await verifyPin(newPin, identity.pinHash))) {
        setError(t('staff.error.pinTaken'));
        return;
      }
    }

    setSaving(true);
    try {
      const pinHash = await hashPin(newPin);
      await resetStaffPinOnServer({
        staffId: person.id,
        pin: newPin,
        deviceToken: token,
      });
      try {
        await updateStaffPinHash(db, person.id, pinHash);
      } catch {
        // The server already has the new PIN. Tell the owner to repeat the
        // action so this phone's offline hash catches up, rather than saying
        // the whole change failed.
        setMessage(t('staff.reset.localFailed', { name: person.name }));
        resetPinForm();
        reload();
        return;
      }
      setMessage(t('staff.reset.saved', { name: person.name }));
      resetPinForm();
      reload();
    } catch (cause) {
      if (!wantsConnect(cause, 'reset')) setError(describeApiError(cause));
    } finally {
      setSaving(false);
    }
  }

  function handleConnected(token: string) {
    setNeedsConnect(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'add') void handleAdd(token);
    if (action === 'reset') void handleResetPin(token);
  }

  // Shown before the owner even types, whenever an add or PIN change is open
  // and this phone has no key, so the reconnect happens in place.
  const showConnect = (adding || resettingId !== null) && (needsConnect || !deviceToken);

  return (
    <Screen
      title={t('staff.title')}
      subtitle={t('staff.subtitle')}
      footer={
        adding ? (
          <View style={styles.footerRow}>
            <View style={styles.footerButton}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={() => {
                  resetForm();
                  setAdding(false);
                }}
              />
            </View>
            <View style={styles.footerButton}>
              <Button
                label={saving ? t('staff.saving') : t('common.save')}
                disabled={saving}
                loading={saving}
                onPress={() => void handleAdd()}
              />
            </View>
          </View>
        ) : resettingId ? (
          <View style={styles.footerRow}>
            <View style={styles.footerButton}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={resetPinForm}
              />
            </View>
            <View style={styles.footerButton}>
              <Button
                label={saving ? t('staff.saving') : t('common.save')}
                disabled={saving}
                loading={saving}
                onPress={() => void handleResetPin()}
              />
            </View>
          </View>
        ) : (
          <Button
            label={t('staff.add')}
            onPress={() => {
              resetPinForm();
              setAdding(true);
            }}
          />
        )
      }
    >
      {ownerPreview ? (
        <Card>
          <View style={styles.row}>
            <View>
              <Text style={styles.name}>{ownerPreview.name}</Text>
              <Text style={styles.muted}>{formatPhone(ownerPreview.phone)}</Text>
            </View>
            <Pill label={t('staff.role.owner')} tone="info" />
          </View>
        </Card>
      ) : null}

      <SectionTitle>{t('staff.people')}</SectionTitle>
      {staff.length === 0 ? (
        <EmptyState icon="group" title={t('staff.empty.title')} message={t('staff.emptyHint')} />
      ) : null}
      {staff.map((person) => (
        <Card key={person.id}>
          <View style={styles.row}>
            <View style={styles.personText}>
              <Text style={styles.name}>{person.name}</Text>
              <Text style={styles.muted}>{formatPhone(person.phone)}</Text>
            </View>
            <Pill
              label={person.firstSignedInAt ? t('staff.signedIn') : t('staff.notSignedIn')}
              tone={person.firstSignedInAt ? 'success' : 'warning'}
            />
          </View>
          {resettingId === person.id ? null : (
            <Button
              label={t('staff.changePin')}
              variant="secondary"
              onPress={() => startPinReset(person)}
            />
          )}
        </Card>
      ))}

      {showConnect ? <ConnectDevice lead={t('connect.staffFirst')} onConnected={handleConnected} /> : null}

      {resettingId ? (
        <Card>
          <Text style={styles.formTitle}>
            {t('staff.reset.title', { name: resetPerson?.name ?? '' })}
          </Text>
          <Field
            label={t('staff.newPin')}
            value={newPin}
            onChangeText={(value) => setNewPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            autoFocus
            required
          />
          <Field
            label={t('staff.confirmNewPin')}
            value={confirmNewPin}
            onChangeText={(value) => setConfirmNewPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            required
          />
          <Text style={styles.muted}>{t('staff.reset.note')}</Text>
        </Card>
      ) : null}

      {adding ? (
        <Card>
          <Text style={styles.formTitle}>{t('staff.add')}</Text>
          <Field
            label={t('staff.name')}
            value={name}
            onChangeText={setName}
            placeholder="Given Phiri"
            required
          />
          <Field
            label={t('staff.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="096 555 1122"
            keyboardType="phone-pad"
            required
          />
          <Field
            label={t('staff.pin')}
            value={pin}
            onChangeText={(value) => setPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            required
          />
          <Field
            label={t('staff.confirmPin')}
            value={confirmPin}
            onChangeText={(value) => setConfirmPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            maxLength={MAX_PIN_LENGTH}
            required
          />
          <Text style={styles.muted}>{t('staff.internetNote')}</Text>
        </Card>
      ) : null}

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>{t('staff.emptyHint')}</Text>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  personText: { flexShrink: 1 },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  formTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  footerButton: { flex: 1 },
}));
