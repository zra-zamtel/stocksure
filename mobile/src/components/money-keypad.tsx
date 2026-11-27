// The big on-screen number pad for counting cash. The phone keyboard hides half
// the screen and offers letters; this one shows only what a till needs.
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from '@/components/big-ui';
import { Icon } from '@/components/ui';
import { useI18n } from '@/i18n';
import { pressKey, type KeypadKey } from '@/lib/keypad';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

export function MoneyKeypad({
  value,
  onChange,
  label,
  disabled,
}: {
  /** The typed amount as text, e.g. "125.5" (the parent owns it). */
  value: string;
  onChange: (next: string) => void;
  /** Accessible name for the amount display, e.g. "Cash counted". */
  label: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const shown = `K${value || '0'}`;

  return (
    <View style={styles.root}>
      {/* A live region so TalkBack reads the new total after every key. */}
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {shown}
        </Text>
      </View>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((key) => (
            <PressScale
              key={key}
              disabled={disabled}
              onPress={() => onChange(pressKey(value, key))}
              accessibilityLabel={
                key === 'back' ? t('keypad.delete') : key === '.' ? t('keypad.point') : key
              }
              style={[styles.key, disabled && styles.dimmed]}
            >
              {key === 'back' ? (
                <Icon name="backspace" size={iconSize.xl} color={colors.text} />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </PressScale>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { gap: spacing.sm },
    amount: {
      fontFamily: fonts.display,
      fontSize: typeScale.money,
      color: colors.text,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      paddingVertical: spacing.md,
    },
    row: { flexDirection: 'row', gap: spacing.sm },
    key: {
      flex: 1,
      minHeight: touch.big,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    keyText: {
      fontFamily: fonts.display,
      fontSize: typeScale.title,
      color: colors.text,
    },
    dimmed: { opacity: 0.5 },
  })
);
