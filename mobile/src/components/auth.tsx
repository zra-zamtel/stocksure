import type { AndroidSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MAX_PIN_LENGTH, normalisePin } from '@/core';
import { Icon } from './ui';
import { colors, radii, spacing, touch, typeScale } from '../theme/tokens';

/**
 * Pieces shared by the sign-in screens so they read as one family with setup:
 * PIN boxes instead of a plain text box, one inline message style, and the
 * other ways in shown as tappable rows rather than a stack of grey buttons.
 */

const MIN_PIN = 4;

/** "elton chiwala" -> "Elton Chiwala", for greeting the owner by name. */
export function displayName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * A 4 to 6 digit PIN typed into one hidden input and drawn as boxes. Four
 * boxes show at first and one more appears as each digit lands, up to six.
 * When `shakeKey` changes (a wrong PIN) the row shakes and turns red.
 */
export function PinBoxes({
  label,
  value,
  onChange,
  autoFocus,
  invalid,
  shakeKey,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  shakeKey?: number;
  onSubmit?: () => void;
}) {
  const shake = useSharedValue(0);
  const boxes = Math.min(MAX_PIN_LENGTH, Math.max(MIN_PIN, value.length + 1));

  useEffect(() => {
    if (!shakeKey) return;
    shake.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withSpring(0)
    );
  }, [shake, shakeKey]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <View style={styles.pin}>
      <Text style={styles.pinLabel}>{label}</Text>
      <Animated.View style={[styles.pinRow, shakeStyle]}>
        {Array.from({ length: boxes }, (_, index) => {
          const filled = index < value.length;
          const active = index === Math.min(value.length, MAX_PIN_LENGTH - 1);
          return (
            <View
              key={index}
              style={[
                styles.pinBox,
                filled && styles.pinBoxFilled,
                active && styles.pinBoxActive,
                invalid && styles.pinBoxInvalid,
              ]}
            >
              {filled ? <PinDot /> : null}
            </View>
          );
        })}
        {/* The real input covers the boxes, so a tap anywhere focuses it. */}
        <TextInput
          value={value}
          onChangeText={(text) => onChange(normalisePin(text))}
          keyboardType="number-pad"
          maxLength={MAX_PIN_LENGTH}
          autoFocus={autoFocus}
          secureTextEntry
          caretHidden
          contextMenuHidden
          accessibilityLabel={label}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          style={styles.pinInput}
        />
      </Animated.View>
    </View>
  );
}

function PinDot() {
  const scale = useSharedValue(0.3);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 10, stiffness: 260 });
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[styles.pinDot, style]} />;
}

const NOTICE = {
  error: { icon: 'error', ink: colors.danger, bg: colors.dangerSoft },
  success: { icon: 'check_circle', ink: colors.success, bg: colors.successSoft },
  info: { icon: 'info', ink: colors.info, bg: colors.infoSoft },
  warning: { icon: 'warning', ink: colors.warning, bg: colors.warningSoft },
} as const satisfies Record<string, { icon: AndroidSymbol; ink: string; bg: string }>;

/** One inline message style for errors, confirmations and tips. */
export function Notice({
  tone,
  children,
  action,
}: {
  tone: keyof typeof NOTICE;
  children: ReactNode;
  action?: ReactNode;
}) {
  const look = NOTICE[tone];
  return (
    <View style={[styles.notice, { backgroundColor: look.bg }]} accessibilityLiveRegion="polite">
      <View style={styles.noticeRow}>
        <Icon name={look.icon} size={20} color={look.ink} />
        <Text style={[styles.noticeText, { color: tone === 'info' ? colors.text : look.ink }]}>{children}</Text>
      </View>
      {action}
    </View>
  );
}

/** A small muted line with an icon, e.g. "Works without internet". */
export function Hint({ icon, children }: { icon: AndroidSymbol; children: ReactNode }) {
  return (
    <View style={styles.hint}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text style={styles.hintText}>{children}</Text>
    </View>
  );
}

/** "Other ways to sign in" with a hairline either side. */
export function SectionDivider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** A full-width row that leads somewhere else: icon, title, a line, chevron. */
export function OptionRow({
  icon,
  title,
  caption,
  onPress,
}: {
  icon: AndroidSymbol;
  title: string;
  caption?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}. ${caption}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
    >
      <View style={styles.optionIcon}>
        <Icon name={icon} size={22} color={colors.primaryInk} />
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        {caption ? <Text style={styles.optionCaption}>{caption}</Text> : null}
      </View>
      <Icon name="chevron_right" color={colors.textMuted} />
    </Pressable>
  );
}

/** Initials in a blue circle, greeting a known owner. */
export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = displayName(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessible={false}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { gap: spacing.sm },
  pinLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  pinRow: { flexDirection: 'row', gap: spacing.sm },
  // Boxes share the row and cap at 52px, so six still fit a 320px screen.
  pinBox: {
    flex: 1,
    maxWidth: 52,
    height: 60,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBoxFilled: { borderColor: colors.charcoal },
  pinBoxActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  pinBoxInvalid: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.charcoal },
  pinInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
  notice: { borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  noticeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: typeScale.body, lineHeight: 21, fontWeight: '600' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hintText: { flexShrink: 1, fontSize: typeScale.label, color: colors.textMuted, lineHeight: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: {
    fontSize: typeScale.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  option: {
    minHeight: touch.minHeight + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionPressed: { backgroundColor: colors.surfaceAlt },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  optionCaption: { fontSize: typeScale.label, color: colors.textMuted, lineHeight: 18 },
  avatar: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryText, fontWeight: '800' },
});
