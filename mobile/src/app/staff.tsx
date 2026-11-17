import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Card, Pill, Screen } from '@/components/ui';
import { formatPhone } from '@/core';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function StaffScreen() {
  const { t } = useI18n();
  const { ownerPreview } = useAuth();

  return (
    <Screen title={t('staff.title')} footer={<Button label={t('staff.add')} disabled />}>
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
      ) : (
        <Text style={styles.muted}>{t('common.notYet')}</Text>
      )}
      <Text style={styles.muted}>{t('staff.empty')}</Text>
      <Text style={styles.muted}>{t('common.backendPending')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
