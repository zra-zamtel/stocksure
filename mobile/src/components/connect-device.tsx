import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OwnerMismatchError, useAuth } from '@/auth/session';
import { useSync } from '@/db/use-sync';
import { useI18n } from '@/i18n';
import { ApiError, type ApiErrorCode } from '@/lib/api';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';
import { Notice } from './auth';
import { Button, Card, Field, Icon, IconBadge, IconButton, TextLink } from './ui';

// Hidden for the rest of this app session once the owner closes it.
let reminderDismissed = false;

const CODE_LENGTH = 6;

const ERROR_KEYS: Partial<Record<ApiErrorCode, string>> = {
  offline: 'connect.error.offline',
  'invalid-code': 'auth.code.error.invalid',
  'expired-code': 'auth.code.error.expired',
  'too-many-attempts': 'auth.code.error.tooMany',
  validation: 'auth.code.error.invalid',
};

/**
 * Reconnects this phone to the owner's online account in place: the email is
 * filled in, one tap sends a 6-digit code, typing the sixth digit finishes.
 * No password, no new PIN and no leaving the screen.
 */
export function ConnectDevice({
  onConnected,
  lead,
  bare,
}: {
  /** Runs once the phone is connected, e.g. to finish adding a staff member. */
  onConnected?: (deviceToken: string) => void;
  /** One short line under the title that says why this is needed here. */
  lead?: string;
  /** Without its own card, for a sheet or panel that already has one. */
  bare?: boolean;
}) {
  const { t } = useI18n();
  const { ownerPreview, requestOwnerEmailCode, connectOwnerDevice } = useAuth();
  const [email, setEmail] = useState(ownerPreview?.email ?? '');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'sending' | 'code' | 'checking' | 'done'>('email');
  const [error, setError] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);

  function explain(cause: unknown, fallback: string): string {
    if (cause instanceof OwnerMismatchError) return t('connect.error.mismatch');
    if (cause instanceof ApiError) return t(ERROR_KEYS[cause.code] ?? fallback);
    return t(fallback);
  }

  async function send() {
    if (!email.trim() || phase === 'sending' || phase === 'checking') return;
    const back = phase === 'code' ? 'code' : 'email';
    setPhase('sending');
    setError(null);
    setCode('');
    try {
      const result = await requestOwnerEmailCode(email, ownerPreview?.phone);
      setDemoCode(result.demoCode ?? null);
      setPhase('code');
    } catch (cause) {
      setError(explain(cause, 'connect.error.send'));
      setPhase(back);
    }
  }

  async function confirm(value = code) {
    if (value.length !== CODE_LENGTH || phase === 'checking') return;
    setPhase('checking');
    setError(null);
    try {
      const token = await connectOwnerDevice({ email, code: value });
      setPhase('done');
      onConnected?.(token);
    } catch (cause) {
      setError(explain(cause, 'auth.code.error.invalid'));
      setCode('');
      setPhase('code');
    }
  }

  if (phase === 'done') return <Notice tone="success">{t('connect.done')}</Notice>;

  const askingCode = phase === 'code' || phase === 'checking';

  const content = (
    <>
      <View style={styles.head}>
        <IconBadge name="cloud_sync" tone="primary" size={44} />
        <View style={styles.flex}>
          <Text style={styles.title}>{t('connect.title')}</Text>
          <Text style={styles.lead}>{lead ?? t('connect.whyShort')}</Text>
        </View>
      </View>

      {askingCode ? (
        <>
          <View style={styles.sentTo}>
            <Text style={styles.lead}>{t('connect.sentTo')}</Text>
            <View style={styles.emailRow}>
              <Text style={styles.email} numberOfLines={1} ellipsizeMode="middle">
                {email.trim()}
              </Text>
              <TextLink accent label={t('connect.change')} onPress={() => setPhase('email')} />
            </View>
          </View>
          {demoCode ? <Notice tone="info">{`${demoCode} · ${t('auth.code.demoNote')}`}</Notice> : null}
          <CodeBoxes
            value={code}
            invalid={Boolean(error)}
            onChange={(next) => {
              setCode(next);
              setError(null);
              // The sixth digit submits, so there is nothing else to tap.
              if (next.length === CODE_LENGTH) void confirm(next);
            }}
          />
          <Button
            label={phase === 'checking' ? t('auth.code.checking') : t('connect.confirm')}
            loading={phase === 'checking'}
            disabled={code.length !== CODE_LENGTH}
            onPress={() => void confirm()}
          />
          <TextLink label={t('verify.resend')} onPress={() => void send()} />
        </>
      ) : (
        <>
          <Field
            label={t('connect.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            icon="mail"
          />
          <Button
            label={phase === 'sending' ? t('auth.code.sending') : t('connect.send')}
            icon="send"
            loading={phase === 'sending'}
            disabled={!email.trim()}
            onPress={() => void send()}
          />
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );

  return bare ? <View style={styles.stack}>{content}</View> : <Card style={styles.stack}>{content}</Card>;
}

/** Six boxes that show the digits as they are typed. One hidden input drives them. */
function CodeBoxes({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    // Opening the code step brings the keyboard up straight away.
    const timer = setTimeout(() => input.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Pressable onPress={() => input.current?.focus()} style={styles.codeRow} accessible={false}>
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const digit = value[index];
        const active = index === Math.min(value.length, CODE_LENGTH - 1);
        return (
          <View
            key={index}
            style={[
              styles.codeBox,
              digit ? styles.codeBoxFilled : null,
              active && !invalid ? styles.codeBoxActive : null,
              invalid ? styles.codeBoxInvalid : null,
            ]}
          >
            <Text style={styles.codeDigit}>{digit ?? ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        // Pasting the code from the email works: anything that is not a digit
        // is dropped, so "Your code is 123 456" still fills the six boxes.
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        caretHidden
        accessibilityLabel={t('auth.code.label')}
        style={styles.codeInput}
      />
    </Pressable>
  );
}

/** The connect steps in a bottom sheet, so a screen keeps its own layout. */
export function ConnectSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.flex} onPress={onClose} accessible={false} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.grabber} />
          <ConnectDevice bare onConnected={() => setTimeout(onClose, 900)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * A small warning row, like the backup one, for a screen that needs the phone
 * connected (asking for mobile money, Smart Invoice, a trading record). It
 * replaces the full connect form inline: one line, and the steps open in a
 * sheet when tapped. Settings keeps the full form.
 */
export function ConnectNotice({ title, onConnected }: { title: string; onConnected?: () => void }) {
  const { t } = useI18n();
  const { deviceToken } = useAuth();
  const [open, setOpen] = useState(false);
  // Stay mounted while the sheet is open: connecting sets the key mid-sheet,
  // and the sheet must still close properly and report back.
  if (deviceToken && !open) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${t('connect.tapToConnect')}`}
        onPress={() => setOpen(true)}
        android_ripple={{ color: colors.ripple }}
        style={({ pressed }) => [styles.reminder, pressed && styles.reminderPressed]}
      >
        <Icon name="cloud_off" size={iconSize.md} color={colors.warning} />
        <View style={styles.flex}>
          <Text style={styles.reminderTitle}>{title}</Text>
          <Text style={styles.reminderText}>{t('connect.tapToConnect')}</Text>
        </View>
        <Icon name="chevron_right" size={iconSize.md} color={colors.warning} />
      </Pressable>
      <ConnectSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          onConnected?.();
        }}
      />
    </>
  );
}

/**
 * One slim line on Home for an owner whose phone is not connected, because
 * without the key nothing is backed up. Tapping it opens the sheet; the cross
 * hides it until the app is opened again.
 */
export function ConnectReminder({ dismissible = true }: { dismissible?: boolean } = {}) {
  const { t } = useI18n();
  const { user, deviceToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(reminderDismissed);

  if (user?.role !== 'owner' || deviceToken || (dismissible && hidden)) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('connect.short')}. ${t('connect.tapToConnect')}`}
        onPress={() => setOpen(true)}
        android_ripple={{ color: colors.ripple }}
        style={({ pressed }) => [styles.reminder, pressed && styles.reminderPressed]}
      >
        <Icon name="cloud_off" size={iconSize.md} color={colors.warning} />
        <View style={styles.flex}>
          <Text style={styles.reminderTitle}>{t('connect.short')}</Text>
          <Text style={styles.reminderText}>{t('connect.tapToConnect')}</Text>
        </View>
        {dismissible ? (
          <IconButton
            name="close"
            label={t('connect.later')}
            onPress={() => {
              reminderDismissed = true;
              setHidden(true);
            }}
          />
        ) : (
          <Icon name="chevron_right" size={iconSize.md} color={colors.warning} />
        )}
      </Pressable>
      <ConnectSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Says in plain words why changes are not uploading, with the one thing that
 * fixes it. Shown on Home and in Settings so a stuck backup is never only at
 * the bottom of a settings page.
 */
export function SyncProblemBanner() {
  const { t } = useI18n();
  const { user } = useAuth();
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const problem = sync.problem;
  if (!problem || (problem === 'offline' && sync.pending === 0)) return null;

  const owner = user?.role === 'owner';
  const count = sync.pending;
  const title = problem === 'expired' ? t('sync.problem.expired.title') : t('sync.problem.title');
  const text =
    problem === 'expired'
      ? owner
        ? t('sync.problem.expired.owner', { count })
        : t('sync.problem.expired.staff', { count })
      : problem === 'offline'
        ? t('sync.problem.offline', { count })
        : t('sync.problem.server', { count });
  const action =
    problem === 'expired'
      ? owner
        ? t('sync.problem.expired.action')
        : null
      : sync.busy
        ? t('sync.syncing')
        : t('sync.problem.retry');
  const onPress =
    problem === 'expired'
      ? owner
        ? () => setOpen(true)
        : undefined
      : () => {
          if (!sync.busy) void sync.syncNow();
        };

  return (
    <>
      <Pressable
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={`${title}. ${text}${action ? `. ${action}` : ''}`}
        accessibilityLiveRegion="polite"
        disabled={!onPress}
        onPress={onPress}
        android_ripple={onPress ? { color: colors.ripple } : undefined}
        style={({ pressed }) => [styles.reminder, pressed && styles.reminderPressed]}
      >
        <Icon name={problem === 'offline' ? 'cloud_off' : 'sync_problem'} size={iconSize.md} color={colors.warning} />
        <View style={styles.flex}>
          <Text style={styles.reminderTitle}>{title}</Text>
          <Text style={styles.reminderText}>{text}</Text>
          {action ? <Text style={styles.reminderAction}>{action}</Text> : null}
        </View>
        {onPress ? <Icon name="chevron_right" size={iconSize.md} color={colors.warning} /> : null}
      </Pressable>
      <ConnectSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          // Connected or not, try again: a fresh key uploads straight away.
          void sync.syncNow();
        }}
      />
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
  lead: { fontSize: typeScale.label, lineHeight: 19, color: colors.textMuted },
  sentTo: { gap: 2 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  email: { flexShrink: 1, fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  codeBox: {
    flex: 1,
    maxWidth: 52,
    height: 58,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: { borderColor: colors.charcoal, backgroundColor: colors.surface },
  codeBoxActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  codeBoxInvalid: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  codeDigit: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text },
  codeInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent' },
  backdrop: { flex: 1, backgroundColor: 'rgba(30, 30, 28, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    ...elevation.raised,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  reminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minHeight + spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.warningSoft,
    overflow: 'hidden',
  },
  reminderPressed: { opacity: 0.85 },
  reminderTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.warning },
  reminderText: { fontSize: typeScale.label, color: colors.text },
  reminderAction: { marginTop: 2, fontSize: typeScale.label, fontWeight: '700', color: colors.warning },
}));
