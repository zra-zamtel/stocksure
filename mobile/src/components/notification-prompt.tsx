import { StyleSheet, Text, View } from 'react-native';
import { Button, IconBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useNotifications } from '@/notifications/provider';
import { colors, elevation, fonts, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

/**
 * Asked once, after setup: a card on Home rather than a dialog at launch, so
 * the owner knows why before the phone asks. Either answer hides it for good;
 * Settings can turn alerts on later.
 */
export function NotificationPrompt() {
  const { t } = useI18n();
  const { promptVisible, turnOn, dismissPrompt } = useNotifications();
  if (!promptVisible) return null;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <IconBadge name="notifications" tone="primary" size={touch.big} />
        <View style={styles.text}>
          <Text style={styles.title}>{t('notify.prompt.title')}</Text>
          <Text style={styles.body}>{t('notify.prompt.body')}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label={t('notify.prompt.later')} variant="secondary" onPress={dismissPrompt} />
        </View>
        <View style={styles.action}>
          <Button label={t('notify.prompt.turnOn')} icon="notifications_active" onPress={() => void turnOn()} />
        </View>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation.card,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    text: { flex: 1, gap: spacing.xxs },
    title: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
    body: { fontSize: typeScale.body, color: colors.textMuted },
    actions: { flexDirection: 'row', gap: spacing.md },
    action: { flex: 1 },
  })
);
