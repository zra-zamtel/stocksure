import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { BottomSheet } from '@/components/big-ui';
import { ConnectReminder, SyncProblemBanner } from '@/components/connect-device';
import { Icon } from '@/components/ui';
import { useSync } from '@/db/use-sync';
import { useI18n } from '@/i18n';
import { colors, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

export type BackupState = 'ok' | 'attention' | 'problem';

/**
 * Where the backup stands, for the small cloud in the Home header: fine,
 * needs a tap (the owner has not connected this phone), or a real problem
 * (changes are not uploading). Waiting offline with nothing queued is fine.
 */
export function useBackupState(): { state: BackupState; expired: boolean } {
  const { user, deviceToken } = useAuth();
  const sync = useSync();
  const problem = !!sync.problem && !(sync.problem === 'offline' && sync.pending === 0);
  const notConnected = user?.role === 'owner' && !deviceToken;
  return {
    state: problem ? 'problem' : notConnected ? 'attention' : 'ok',
    expired: sync.problem === 'expired',
  };
}

const LOOK = {
  ok: { icon: 'cloud_done', tone: 'muted' },
  attention: { icon: 'cloud_off', tone: 'warning' },
  problem: { icon: 'sync_problem', tone: 'danger' },
} as const;

/**
 * A cloud icon in the header that changes colour and shape when the backup
 * needs attention, and opens a sheet with the one message and button that
 * fix it. Keeps connect and backup notices off the main Home view.
 */
export function BackupStatusButton() {
  const { t } = useI18n();
  const { state } = useBackupState();
  const [open, setOpen] = useState(false);
  const look = LOOK[state];
  const label = t(`home.backup.${state}`);
  const fg = look.tone === 'danger' ? colors.danger : look.tone === 'warning' ? colors.warning : colors.textMuted;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        android_ripple={{ color: colors.ripple, borderless: true }}
        style={[
          styles.button,
          state === 'problem' && styles.problem,
          state === 'attention' && styles.attention,
        ]}
      >
        <Icon name={look.icon} size={iconSize.lg} color={fg} />
      </Pressable>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('home.backup.title')}
        closeLabel={t('common.close')}
      >
        {state === 'ok' ? (
          <View style={styles.okRow}>
            <Icon name="cloud_done" size={iconSize.xl} color={colors.success} />
            <Text style={styles.okText}>{t('home.backup.okLong')}</Text>
          </View>
        ) : null}
        <SyncProblemBanner />
        <ConnectReminder dismissible={false} />
      </BottomSheet>
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    button: {
      width: touch.big,
      height: touch.big,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    problem: { backgroundColor: colors.dangerSoft },
    attention: { backgroundColor: colors.warningSoft },
    okRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    okText: { flex: 1, fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  })
);
