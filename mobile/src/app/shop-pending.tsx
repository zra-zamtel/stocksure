import { StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, typeScale } from '@/theme/tokens';

/**
 * A staff member can prove their identity on a new phone, but the shop's
 * products and sales still arrive through sync/restore (#4 and #6). Until then
 * this screen is honest about the missing data instead of dropping them into
 * owner onboarding.
 */
export default function ShopPendingScreen() {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const isStaff = user?.role === 'staff';

  return (
    <Screen
      title={t('shop.pending.title')}
      subtitle={user ? `${user.name} · ${t(`staff.role.${user.role}`)}` : undefined}
      footer={<Button label={t('settings.signOut')} onPress={signOut} />}
    >
      <Card>
        <Text style={styles.body}>
          {t(isStaff ? 'shop.pending.body' : 'shop.pending.ownerBody')}
        </Text>
      </Card>
      <Text style={styles.muted}>
        {t(isStaff ? 'shop.pending.note' : 'shop.pending.ownerNote')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: typeScale.body, color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
