import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/session';
import { displayName } from '@/components/auth';
import { ConnectSheet } from '@/components/connect-device';
import { Icon } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The round avatar in the top corner of Home. Tapping it opens a small panel
 * with who is signed in, Settings (for owners) and Sign out, so account
 * actions are always one tap away.
 */
export function ProfileMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, can, signOut, deviceToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const isOwner = user?.role === 'owner';
  const connected = Boolean(deviceToken);

  function close() {
    setOpen(false);
  }

  if (!user) return null;
  const name = displayName(user.name);

  function go(action: () => void) {
    close();
    action();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.open')}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
      >
        <Text style={styles.avatarText}>{initials(name)}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t('common.close')}>
          <Pressable
            style={[styles.panel, { marginTop: insets.top + spacing.xl }]}
            onPress={() => {}}
          >
            <View style={styles.who}>
              <View style={[styles.avatar, styles.avatarLarge]}>
                <Text style={[styles.avatarText, styles.avatarTextLarge]}>{initials(name)}</Text>
              </View>
              <View style={styles.whoText}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {`${t(user.role === 'owner' ? 'staff.role.owner' : 'staff.role.staff')} · ${user.phone}`}
                </Text>
              </View>
            </View>

            {isOwner ? (
              <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={connected ? t('connect.on') : `${t('connect.off')}. ${t('connect.title')}`}
                  disabled={connected}
                  onPress={() => go(() => setConnectOpen(true))}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <Icon
                    name={connected ? 'cloud_done' : 'cloud_off'}
                    size={22}
                    color={connected ? colors.success : colors.warning}
                  />
                  <View style={styles.statusText}>
                    <Text style={[styles.itemLabel, { color: colors.text }]}>
                      {connected ? t('connect.on') : t('connect.title')}
                    </Text>
                    {connected ? null : <Text style={styles.meta}>{t('connect.off')}</Text>}
                  </View>
                  {connected ? null : <Icon name="chevron_right" size={20} color={colors.textMuted} />}
                </Pressable>
            ) : null}

            {can('settings.view') ? (
              <MenuItem icon="settings" label={t('nav.settings')} onPress={() => go(() => router.push('/settings'))} />
            ) : null}
            <MenuItem icon="logout" label={t('settings.signOut')} danger onPress={() => go(signOut)} />
          </Pressable>
        </Pressable>
      </Modal>
      <ConnectSheet visible={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: 'settings' | 'logout';
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Icon name={icon} size={22} color={tint} />
      <Text style={[styles.itemLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  avatar: {
    width: touch.minHeight,
    height: touch.minHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  avatarText: { color: '#FFFFFF', fontWeight: '800', fontSize: typeScale.body },
  avatarLarge: { width: 52, height: 52 },
  avatarTextLarge: { fontSize: typeScale.heading },
  backdrop: { flex: 1, backgroundColor: 'rgba(30,30,28,0.35)', alignItems: 'flex-end', paddingHorizontal: spacing.lg },
  panel: {
    width: 280,
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  whoText: { flex: 1 },
  name: { fontSize: typeScale.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: typeScale.label, color: colors.textMuted, marginTop: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minHeight,
    paddingHorizontal: spacing.lg,
  },
  itemPressed: { backgroundColor: colors.bg },
  itemLabel: { fontSize: typeScale.body, fontWeight: '600' },
  statusText: { flex: 1, paddingVertical: spacing.sm },
}));
