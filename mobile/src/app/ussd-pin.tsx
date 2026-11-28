import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName, Hint, Notice, PinBoxes } from '@/components/auth';
import { ConnectDevice } from '@/components/connect-device';
import { Button, Icon, Screen, SectionTitle, TextLink } from '@/components/ui';
import { formatPhone, isValidPin } from '@/core';
import { useStaff } from '@/db/hooks';
import { useI18n } from '@/i18n';
import {
  ApiError,
  getUssdPinsOnServer,
  removeUssdPinOnServer,
  setUssdPinOnServer,
  type UssdPinStatus,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useFlash } from '@/lib/use-flash';
import { colors, elevation, radii, spacing, themed, typeScale } from '@/theme/tokens';

/** Shown on this screen when the build knows the shop's dial code, e.g. *384*123#. */
const DIAL_CODE = process.env.EXPO_PUBLIC_USSD_CODE?.trim() || null;

type Person = { id: string; name: string; phone: string; isOwner: boolean };

/** The last 9 digits, so 0977…, 260977… and +260 977… compare equal. */
const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-9);

/**
 * USSD lets the owner and staff use StockSure from any phone by dialling a
 * code. The number they dial from picks the account and this PIN proves it is
 * them. Staff sign in on the owner's phone, so the owner sets every PIN here.
 */
export default function UssdPinScreen() {
  const { t } = useI18n();
  const { user, ownerPreview, deviceToken, renewDeviceToken } = useAuth();
  const { data: staff } = useStaff();

  const [statuses, setStatuses] = useState<UssdPinStatus[] | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFlash();

  const people: Person[] = [
    ...(user && ownerPreview
      ? [{ id: user.id, name: ownerPreview.name, phone: ownerPreview.phone, isOwner: true }]
      : []),
    ...staff.map((person) => ({ id: person.id, name: person.name, phone: person.phone, isOwner: false })),
  ];

  const statusFor = (person: Person) =>
    statuses?.find((row) => row.userId === person.id) ??
    statuses?.find((row) => phoneKey(row.phone) === phoneKey(person.phone)) ??
    null;

  const describe = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        if (cause.code === 'offline') return t('ussd.error.offline');
        if (cause.code === 'staff-not-found') return t('ussd.error.notFound');
        if (cause.code === 'validation') return t('ussd.error.pinInvalid');
      }
      return t('ussd.error.server');
    },
    [t]
  );

  /** One online call, renewing an expired device key once before asking to reconnect. */
  const withKey = useCallback(
    async <T,>(call: (key: string) => Promise<T>): Promise<T | null> => {
      if (!deviceToken) {
        setNeedsConnect(true);
        return null;
      }
      try {
        return await call(deviceToken);
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== 'unauthorized') throw cause;
        const renewed = await renewDeviceToken();
        if (!renewed) {
          setNeedsConnect(true);
          return null;
        }
        return call(renewed);
      }
    },
    [deviceToken, renewDeviceToken]
  );

  const load = useCallback(async () => {
    try {
      const rows = await withKey((key) => getUssdPinsOnServer(key));
      if (rows) {
        setStatuses(rows);
        setError(null);
      }
    } catch (cause) {
      setError(describe(cause));
    }
  }, [withKey, describe]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function open(person: Person) {
    setEditing(person);
    setPin('');
    setConfirmPin('');
    setPinError(null);
    setConfirmError(null);
    setError(null);
    setMessage(null);
  }

  function close() {
    setEditing(null);
    setPin('');
    setConfirmPin('');
    setError(null);
  }

  /** Server ids win; a staff row the phone made before syncing is matched by phone. */
  const serverId = (person: Person) => statusFor(person)?.userId ?? person.id;

  async function save() {
    if (!editing || busy) return;
    setPinError(null);
    setConfirmError(null);
    setError(null);
    if (!isValidPin(pin) || pin.length !== 4) {
      setPinError(t('ussd.error.pinInvalid'));
      return;
    }
    if (pin !== confirmPin) {
      setConfirmError(t('ussd.error.pinMismatch'));
      setShakeKey((key) => key + 1);
      setConfirmPin('');
      return;
    }
    setBusy(true);
    try {
      const saved = await withKey((key) =>
        setUssdPinOnServer({
          deviceToken: key,
          pin,
          userId: editing.isOwner ? undefined : serverId(editing),
        })
      );
      if (!saved) return;
      setMessage(t('ussd.saved', { name: editing.isOwner ? t('ussd.you') : displayName(editing.name) }));
      close();
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const done = await withKey((key) => removeUssdPinOnServer({ deviceToken: key, userId: serverId(editing) }));
      if (!done) return;
      setMessage(t('ussd.turnedOff', { name: editing.isOwner ? t('ussd.you') : displayName(editing.name) }));
      close();
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const editingStatus = editing ? statusFor(editing) : null;

  return (
    <Screen
      back
      title={editing ? t('ussd.form.title', { name: editing.isOwner ? t('ussd.you') : displayName(editing.name) }) : t('ussd.title')}
      subtitle={editing ? undefined : t('ussd.subtitle')}
      footer={
        editing ? (
          <View style={styles.pair}>
            <View style={styles.pairItem}>
              <Button label={t('common.cancel')} variant="secondary" onPress={close} />
            </View>
            <View style={styles.pairItem}>
              <Button
                label={busy ? t('common.saving') : t('common.save')}
                loading={busy}
                disabled={busy || pin.length < 4 || confirmPin.length < 4}
                onPress={() => void save()}
              />
            </View>
          </View>
        ) : undefined
      }
    >
      {needsConnect ? (
        <ConnectDevice
          lead={t('ussd.connectFirst')}
          onConnected={() => {
            setNeedsConnect(false);
            void load();
          }}
        />
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {editing ? (
        <View style={styles.form}>
          <Text style={styles.body}>{t('ussd.form.body', { phone: formatPhone(editing.phone) })}</Text>
          <PinBoxes
            label={t('ussd.form.pin')}
            value={pin}
            onChange={(value) => {
              setPin(value.slice(0, 4));
              if (pinError) setPinError(null);
            }}
            error={pinError}
            autoFocus
          />
          <PinBoxes
            label={t('ussd.form.confirm')}
            value={confirmPin}
            onChange={(value) => {
              setConfirmPin(value.slice(0, 4));
              if (confirmError) setConfirmError(null);
            }}
            invalid={Boolean(confirmError) && confirmPin.length === 0}
            error={confirmError}
            shakeKey={shakeKey}
            onSubmit={() => void save()}
          />
          <Hint icon="lock">{t('ussd.form.different')}</Hint>
          {editingStatus?.isSet ? (
            <View style={styles.centre}>
              <TextLink label={t('ussd.turnOff')} onPress={() => void turnOff()} />
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.how}>
            <Icon name="dialpad" size={22} color={colors.primaryInk} />
            <Text style={styles.howText}>
              {DIAL_CODE ? t('ussd.howWithCode', { code: DIAL_CODE }) : t('ussd.how')}
            </Text>
          </View>

          <SectionTitle>{t('ussd.people')}</SectionTitle>
          <View style={styles.card}>
            {people.map((person, index) => {
              const status = statusFor(person);
              const locked = status?.lockedUntil ? new Date(status.lockedUntil) : null;
              const value =
                statuses === null
                  ? '…'
                  : locked
                    ? t('ussd.status.locked', { time: formatDateTime(locked.toISOString()) })
                    : status?.isSet
                      ? t('ussd.status.on')
                      : t('ussd.status.off');
              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  onPress={() => open(person)}
                  style={({ pressed }) => [
                    styles.row,
                    index === people.length - 1 && styles.rowLast,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name={locked ? 'warning' : status?.isSet ? 'check_circle' : 'radio_button_unchecked'}
                    size={22}
                    color={locked ? colors.warning : status?.isSet ? colors.success : colors.textMuted}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {person.isOwner ? `${displayName(person.name)} · ${t('staff.role.owner')}` : displayName(person.name)}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {value}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>{status?.isSet ? t('ussd.change') : t('ussd.set')}</Text>
                  <Icon name="chevron_right" color={colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
          <Hint icon="info">{t('ussd.staffNote')}</Hint>
        </>
      )}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    form: { gap: spacing.lg },
    body: { fontSize: typeScale.body, color: colors.textMuted },
    pair: { flexDirection: 'row', gap: spacing.md },
    pairItem: { flexGrow: 1, flexBasis: '40%' },
    centre: { alignItems: 'center' },
    how: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceAlt,
    },
    howText: { flex: 1, fontSize: typeScale.body, color: colors.text },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      ...elevation.card,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 60,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    rowLast: { paddingBottom: spacing.md },
    pressed: { backgroundColor: colors.surfaceAlt },
    rowText: { flex: 1, gap: 2 },
    rowName: { fontSize: typeScale.body, fontWeight: '600', color: colors.text },
    rowMeta: { fontSize: typeScale.label, color: colors.textMuted },
    rowAction: { fontSize: typeScale.label, fontWeight: '700', color: colors.primaryInk },
  })
);
