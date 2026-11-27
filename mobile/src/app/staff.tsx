import type { AndroidSymbol } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName, Notice } from '@/components/auth';
import { ConnectDevice } from '@/components/connect-device';
import { Button, EmptyState, Field, FormError, HelpTip, Icon, IconBadge, Screen, SectionTitle } from '@/components/ui';
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
import { createStaff, getOwner, listIdentities, updateStaffPinHash, type StaffRecord } from '@/db/repos';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode, registerStaffOnServer, resetStaffPinOnServer } from '@/lib/api';
import { tintSlot } from '@/lib/product-visual';
import { hashPin, verifyPin } from '@/lib/pin';
import { useFlash } from '@/lib/use-flash';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, tileTints, touch, typeScale } from '@/theme/tokens';

type FieldName = 'name' | 'phone' | 'pin' | 'confirm';
type FieldErrors = Partial<Record<FieldName, string>>;

/** Which box each check belongs under, so the owner sees what to fix. */
const VALIDATION: Partial<Record<AccountErrorCode, { field: FieldName; key: string }>> = {
  'name-required': { field: 'name', key: 'staff.error.nameRequired' },
  'phone-invalid': { field: 'phone', key: 'staff.error.phoneInvalid' },
  'pin-invalid': { field: 'pin', key: 'staff.error.pinInvalid' },
  'pin-mismatch': { field: 'confirm', key: 'staff.error.pinMismatch' },
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

/** What the screen is doing: one task at a time, so the form is never off-screen. */
type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'reset'; id: string } | { kind: 'added'; name: string };

export default function StaffScreen() {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const { ownerPreview, deviceToken, refresh } = useAuth();
  const { data: staff, reload } = useStaff();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  // Field errors sit under their box; anything else goes above the form.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  // "Done" notices fade on their own; errors stay until dealt with.
  const [message, setMessage] = useFlash();
  const [saving, setSaving] = useState(false);
  // Set when an online step found this phone not connected (no key, or the
  // server refused it). The connect panel then shows above the form, and the
  // action the owner pressed runs again once it is connected.
  const [needsConnect, setNeedsConnect] = useState(false);
  const [pendingAction, setPendingAction] = useState<'add' | 'reset' | null>(null);
  const retryKey = useRef<{ phone: string; id: string } | null>(null);

  const resetPerson = mode.kind === 'reset' ? (staff.find((person) => person.id === mode.id) ?? null) : null;
  const reveal = { show: t('staff.pin.show'), hide: t('staff.pin.hide') };

  function clearErrors() {
    setFieldErrors({});
    setError(null);
  }

  function backToList() {
    setName('');
    setPhone('');
    setPin('');
    setConfirmPin('');
    setNewPin('');
    setConfirmNewPin('');
    clearErrors();
    setNeedsConnect(false);
    setPendingAction(null);
    setMode({ kind: 'list' });
  }

  function startAdd() {
    backToList();
    setMessage(null);
    setMode({ kind: 'add' });
  }

  function startPinReset(person: StaffRecord) {
    backToList();
    setMessage(null);
    setMode({ kind: 'reset', id: person.id });
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
    clearErrors();

    const errors = validateStaffAccount({ name, phone, pin, confirmPin });
    if (errors.length > 0) {
      const next: FieldErrors = {};
      for (const code of errors) {
        const rule = VALIDATION[code];
        if (rule && !next[rule.field]) next[rule.field] = t(rule.key);
      }
      setFieldErrors(next);
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
      setFieldErrors({ phone: t('staff.error.phoneTaken') });
      return;
    }

    // Two people on one phone must not share a PIN, or sign-in cannot tell
    // them apart. The owner knows the PIN at this point, so catch it early.
    for (const identity of identities) {
      if (await verifyPin(pin, identity.pinHash)) {
        setFieldErrors({ pin: t('staff.error.pinTaken') });
        return;
      }
    }

    setSaving(true);
    try {
      const pinHash = await hashPin(pin);
      // Retrying the same phone number reuses the same key, so a reply lost
      // after the server saved the person returns them instead of "phone taken".
      if (retryKey.current?.phone !== normalised) {
        retryKey.current = { phone: normalised, id: newId('staff') };
      }
      const id = retryKey.current.id;
      // `id` is only the retry key. The server answers with its own id, which
      // is the one PIN resets and the staff member's own phone use, so the
      // local row must carry that one.
      const created = await registerStaffOnServer({
        id,
        ownerId: owner.id,
        name: name.trim(),
        phone: normalised,
        pin,
        deviceToken: token,
      });
      await createStaff(db, { id: created.id || id, name: name.trim(), phone: normalised, pinHash });
      retryKey.current = null;
      const added = displayName(name);
      backToList();
      setMode({ kind: 'added', name: added });
      reload();
      // The owner stops recording sales once the shop has staff.
      void refresh();
    } catch (cause) {
      if (wantsConnect(cause, 'add')) return;
      if (cause instanceof ApiError && cause.code === 'duplicate-phone') {
        setFieldErrors({ phone: t('staff.error.phoneTaken') });
      } else {
        setError(describeApiError(cause));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPin(tokenOverride?: string) {
    const token = tokenOverride ?? (needsConnect ? null : deviceToken);
    if (saving) return;
    clearErrors();

    const person = resetPerson;
    if (!person) {
      setError(t('staff.error.staffNotFound'));
      return;
    }
    if (!isValidPin(newPin)) {
      setFieldErrors({ pin: t('staff.error.pinInvalid') });
      return;
    }
    if (newPin !== confirmNewPin) {
      setFieldErrors({ confirm: t('staff.error.pinMismatch') });
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
        setFieldErrors({ pin: t('staff.error.pinTaken') });
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
      const shown = displayName(person.name);
      try {
        await updateStaffPinHash(db, person.id, pinHash);
      } catch {
        // The server already has the new PIN. Tell the owner to repeat the
        // action so this phone's offline hash catches up, rather than saying
        // the whole change failed.
        backToList();
        setError(t('staff.reset.localFailed', { name: shown }));
        reload();
        return;
      }
      backToList();
      setMessage(t('staff.reset.saved', { name: shown }));
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

  // Shown before the owner even types, whenever a form is open and this phone
  // has no key, so the reconnect happens in place.
  const formOpen = mode.kind === 'add' || mode.kind === 'reset';
  const showConnect = formOpen && (needsConnect || !deviceToken);

  const footer =
    mode.kind === 'add' || mode.kind === 'reset' ? (
      <View style={styles.footerRow}>
        <View style={styles.footerButton}>
          <Button label={t('common.cancel')} variant="secondary" disabled={saving} onPress={backToList} />
        </View>
        <View style={styles.footerButton}>
          <Button
            label={saving ? t('staff.saving') : mode.kind === 'add' ? t('staff.addAction') : t('staff.reset.action')}
            icon={mode.kind === 'add' ? 'person_add' : 'key'}
            disabled={saving}
            loading={saving}
            onPress={() => void (mode.kind === 'add' ? handleAdd() : handleResetPin())}
          />
        </View>
      </View>
    ) : mode.kind === 'added' ? (
      <Button label={t('staff.added.done')} icon="check" onPress={backToList} />
    ) : (
      <Button label={t('staff.add')} icon="person_add" onPress={startAdd} />
    );

  return (
    <Screen
      back
      title={
        mode.kind === 'add'
          ? t('staff.form.addTitle')
          : mode.kind === 'reset'
            ? t('staff.reset.title', { name: resetPerson ? displayName(resetPerson.name) : '' })
            : t('staff.title')
      }
      subtitle={formOpen ? undefined : t('staff.subtitle')}
      footer={footer}
    >
      {showConnect ? <ConnectDevice lead={t('connect.staffFirst')} onConnected={handleConnected} /> : null}
      {error ? <FormError message={error} /> : null}

      {mode.kind === 'add' ? (
        <View style={styles.form}>
          <Field
            label={t('staff.name')}
            icon="person"
            value={name}
            onChangeText={setName}
            placeholder="Given Phiri"
            autoCapitalize="words"
            autoFocus
            required
            error={fieldErrors.name}
          />
          <Field
            label={t('staff.phone')}
            icon="call"
            value={phone}
            onChangeText={setPhone}
            placeholder="096 555 1122"
            keyboardType="phone-pad"
            required
            hint={t('staff.form.phoneHint')}
            error={fieldErrors.phone}
          />
          <Field
            label={t('staff.form.pin')}
            icon="lock"
            value={pin}
            onChangeText={(value) => setPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            revealLabels={reveal}
            maxLength={MAX_PIN_LENGTH}
            required
            hint={t('staff.form.pinHint')}
            error={fieldErrors.pin}
          />
          <Field
            label={t('staff.confirmPin')}
            icon="lock"
            value={confirmPin}
            onChangeText={(value) => setConfirmPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            revealLabels={reveal}
            maxLength={MAX_PIN_LENGTH}
            required
            error={fieldErrors.confirm}
          />
          <HelpTip icon="wifi">{t('staff.internetNote')}</HelpTip>
        </View>
      ) : null}

      {mode.kind === 'reset' && resetPerson ? (
        <View style={styles.form}>
          <View style={styles.personHead}>
            <Avatar name={resetPerson.name} id={resetPerson.id} />
            <View style={styles.personText}>
              <Text style={styles.name}>{displayName(resetPerson.name)}</Text>
              <Text style={styles.muted}>{formatPhone(resetPerson.phone)}</Text>
            </View>
          </View>
          <Field
            label={t('staff.form.newPin')}
            icon="lock"
            value={newPin}
            onChangeText={(value) => setNewPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            revealLabels={reveal}
            maxLength={MAX_PIN_LENGTH}
            autoFocus
            required
            hint={t('staff.form.pinHint')}
            error={fieldErrors.pin}
          />
          <Field
            label={t('staff.confirmNewPin')}
            icon="lock"
            value={confirmNewPin}
            onChangeText={(value) => setConfirmNewPin(normalisePin(value))}
            placeholder="••••"
            keyboardType="numeric"
            secureTextEntry
            revealLabels={reveal}
            maxLength={MAX_PIN_LENGTH}
            required
            error={fieldErrors.confirm}
          />
          <HelpTip icon="wifi">{t('staff.reset.note')}</HelpTip>
        </View>
      ) : null}

      {mode.kind === 'added' ? <HandOver name={mode.name} /> : null}

      {mode.kind === 'list' ? (
        <>
          {message ? <Notice tone="success">{message}</Notice> : null}

          <View style={styles.people}>
            {ownerPreview ? (
              <PersonRow
                name={ownerPreview.name}
                id="owner"
                phone={ownerPreview.phone}
                status={{ icon: 'shield_person', tone: 'primary', label: t('staff.role.owner') }}
              />
            ) : null}
            {staff.map((person) => (
              <PersonRow
                key={person.id}
                name={person.name}
                id={person.id}
                phone={person.phone}
                status={
                  person.firstSignedInAt
                    ? { icon: 'check_circle', tone: 'success', label: t('staff.status.signedIn') }
                    : { icon: 'schedule', tone: 'warning', label: t('staff.status.waiting') }
                }
                action={{ label: t('staff.changePinFor', { name: displayName(person.name) }), onPress: () => startPinReset(person) }}
              />
            ))}
          </View>

          {staff.length === 0 ? (
            <EmptyState icon="group_add" title={t('staff.empty.title')} message={t('staff.empty.body')} />
          ) : null}

          <Rights />
        </>
      ) : null}
    </Screen>
  );
}

/** Initials on a soft tile: the person's "picture", stable per id. */
function Avatar({ name, id }: { name: string; id: string }) {
  const tints = tileTints();
  const tint = tints[tintSlot(id, tints.length)];
  const initials = displayName(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
  return (
    <View style={[styles.avatar, { backgroundColor: tint.bg }]} importantForAccessibility="no-hide-descendants">
      <Text style={[styles.avatarText, { color: tint.fg }]}>{initials || '?'}</Text>
    </View>
  );
}

type Status = { icon: AndroidSymbol; tone: 'primary' | 'success' | 'warning'; label: string };

function PersonRow({
  name,
  id,
  phone,
  status,
  action,
}: {
  name: string;
  id: string;
  phone: string;
  status: Status;
  action?: { label: string; onPress: () => void };
}) {
  const ink = status.tone === 'success' ? colors.success : status.tone === 'warning' ? colors.warning : colors.primaryInk;
  return (
    <View style={styles.personRow}>
      <Avatar name={name} id={id} />
      <View style={styles.personText}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName(name)}
        </Text>
        <Text style={styles.muted}>{formatPhone(phone)}</Text>
        <View style={styles.status}>
          <Icon name={status.icon} size={iconSize.md} color={ink} />
          <Text style={[styles.statusText, { color: ink }]}>{status.label}</Text>
        </View>
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          android_ripple={{ color: colors.ripple, borderless: true, radius: touch.big / 2 }}
          style={({ pressed }) => [styles.keyButton, pressed && styles.pressed]}
        >
          <Icon name="key" size={iconSize.lg} color={colors.primaryInk} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** What a staff member may and may not do, as two short picture lists. */
function Rights() {
  const { t } = useI18n();
  const can: [AndroidSymbol, string][] = [
    ['point_of_sale', t('staff.rights.sell')],
    ['payments', t('staff.rights.count')],
    ['inventory', t('staff.rights.stock')],
  ];
  const cannot: [AndroidSymbol, string][] = [
    ['inventory_2', t('staff.rights.products')],
    ['receipt_long', t('staff.rights.void')],
    ['account_balance', t('staff.rights.tax')],
    ['settings', t('staff.rights.settings')],
  ];
  return (
    <View style={styles.rights}>
      <SectionTitle>{t('staff.rights.title')}</SectionTitle>
      <View style={styles.rightsCard}>
        {can.map(([icon, label]) => (
          <RightRow key={label} icon={icon} label={label} allowed />
        ))}
        <View style={styles.rightsGap} />
        <Text style={styles.rightsHead}>{t('staff.rights.onlyYou')}</Text>
        {cannot.map(([icon, label]) => (
          <RightRow key={label} icon={icon} label={label} allowed={false} />
        ))}
      </View>
    </View>
  );
}

function RightRow({ icon, label, allowed }: { icon: AndroidSymbol; label: string; allowed: boolean }) {
  return (
    <View style={styles.rightRow}>
      <Icon name={icon} size={iconSize.lg} color={colors.textMuted} />
      <Text style={styles.rightText}>{label}</Text>
      {/* Icon and colour together, so "yes" and "no" never rest on colour alone. */}
      <Icon name={allowed ? 'check_circle' : 'lock'} size={iconSize.md} color={allowed ? colors.success : colors.textMuted} />
    </View>
  );
}

/** After adding: the one thing left to do, in three pictured steps. */
function HandOver({ name }: { name: string }) {
  const { t } = useI18n();
  const steps: [AndroidSymbol, string][] = [
    ['key', t('staff.added.step1', { name })],
    ['smartphone', t('staff.added.step2')],
    ['lock_reset', t('staff.added.step3')],
  ];
  return (
    <View style={styles.handOver}>
      <View style={styles.handOverHead}>
        <IconBadge name="how_to_reg" tone="success" size={64} />
        <Text style={styles.handOverTitle}>{t('staff.added.title', { name })}</Text>
      </View>
      {steps.map(([icon, label], index) => (
        <View key={icon} style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>{index + 1}</Text>
          </View>
          <Icon name={icon} size={iconSize.lg} color={colors.primaryInk} />
          <Text style={styles.stepText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    form: { gap: spacing.md },
    people: {
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: spacing.xs,
      ...elevation.card,
    },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: touch.big + spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    personHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    personText: { flex: 1, gap: spacing.xxs },
    avatar: {
      width: touch.big,
      height: touch.big,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontFamily: fonts.display, fontSize: typeScale.heading },
    name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
    muted: { fontSize: typeScale.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
    status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statusText: { fontSize: typeScale.label, fontWeight: '600' },
    keyButton: {
      width: touch.big,
      height: touch.big,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
    rights: { gap: spacing.xs },
    rightsCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    rightsHead: { fontSize: typeScale.label, fontWeight: '700', color: colors.textMuted },
    rightsGap: { height: spacing.xs },
    rightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
    rightText: { flex: 1, fontSize: typeScale.body, color: colors.text },
    handOver: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation.card,
    },
    handOverHead: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    handOverTitle: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, textAlign: 'center' },
    step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touch.big },
    stepNumber: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    stepNumberText: { fontSize: typeScale.label, fontWeight: '700', color: colors.primaryInk },
    stepText: { flex: 1, fontSize: typeScale.body, color: colors.text },
    footerRow: { flexDirection: 'row', gap: spacing.md },
    footerButton: { flex: 1 },
  })
);
