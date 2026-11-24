import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { Button, Card, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { colors, spacing, typeScale } from '@/theme/tokens';

/**
 * An owner on a phone with no shop data (a new phone, a reinstall) gets the
 * shop back from the server here, then carries on: straight to Home when the
 * shop came back, or into shop setup when the server held none yet.
 *
 * A staff member proves their identity on a new phone, but their data still
 * comes from the owner's phone, so for them this screen only explains.
 */
export default function ShopPendingScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, signOut, restoreShop } = useAuth();
  const isStaff = user?.role === 'staff';

  const [state, setState] = useState<'working' | 'offline' | 'failed'>('working');
  const started = useRef(false);

  const restore = useCallback(async () => {
    setState('working');
    try {
      await restoreShop();
      // The gate in the index route picks Home or shop setup.
      router.replace('/');
    } catch (cause) {
      setState(cause instanceof ApiError && cause.code === 'offline' ? 'offline' : 'failed');
    }
  }, [restoreShop, router]);

  useEffect(() => {
    if (isStaff || started.current) return;
    started.current = true;
    void restore();
  }, [isStaff, restore]);

  if (isStaff) {
    return (
      <Screen
        title={t('shop.pending.title')}
        subtitle={user ? `${user.name} · ${t(`staff.role.${user.role}`)}` : undefined}
        footer={<Button label={t('settings.signOut')} onPress={signOut} />}
      >
        <Card>
          <Text style={styles.body}>{t('shop.pending.body')}</Text>
        </Card>
        <Text style={styles.muted}>{t('shop.pending.note')}</Text>
      </Screen>
    );
  }

  return (
    <Screen
      title={t('shop.restore.title')}
      subtitle={user ? `${user.name} · ${t(`staff.role.${user.role}`)}` : undefined}
      footer={
        state === 'working' ? (
          <Button label={t('settings.signOut')} variant="secondary" onPress={signOut} />
        ) : (
          <View style={styles.footer}>
            <Button label={t('shop.restore.retry')} onPress={() => void restore()} />
            <Button label={t('settings.signOut')} variant="secondary" onPress={signOut} />
          </View>
        )
      }
    >
      {state === 'working' ? (
        <Card>
          <View style={styles.working}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>{t('shop.restore.loading')}</Text>
          </View>
        </Card>
      ) : (
        <Notice tone="warning">{t(state === 'offline' ? 'shop.restore.offline' : 'shop.restore.failed')}</Notice>
      )}
      <Text style={styles.muted}>{t('shop.restore.note')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: typeScale.body, color: colors.text, flex: 1 },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footer: { gap: spacing.sm },
});
