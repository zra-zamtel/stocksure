import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

const staff = [
  { id: 'owner-1', name: 'Elton Chiwala', role: 'owner' as const, phone: '097 123 4567' },
  { id: 'staff-1', name: 'Mutale Banda', role: 'staff' as const, phone: '096 555 1122' },
];

export default function StaffScreen() {
  const { t } = useI18n();

  return (
    <Screen title={t('staff.title')} footer={<Button label={t('staff.add')} disabled />}>
      {staff.map((person) => (
        <Card key={person.id}>
          <View style={styles.row}>
            <View>
              <Text style={styles.name}>{person.name}</Text>
              <Text style={styles.muted}>{person.phone}</Text>
            </View>
            <Pill
              label={person.role === 'owner' ? t('staff.role.owner') : t('staff.role.staff')}
              tone={person.role === 'owner' ? 'info' : 'neutral'}
            />
          </View>
        </Card>
      ))}
      <Text style={styles.muted}>{t('common.backendPending')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
});
