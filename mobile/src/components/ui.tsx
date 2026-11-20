import type { ReactNode } from 'react';
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import { colors, radii, spacing, touch, typeScale } from '../theme/tokens';

type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** One small action beside the title, such as the settings gear. */
  action?: ReactNode;
};

// A faint paper grain tiled under every screen, so the warm background reads as
// a material rather than a flat fill. It is a 128px tile, a few KB.
const PAPER = require('../../assets/images/paper.png');

export function Screen({ title, subtitle, children, scroll = true, footer, action }: ScreenProps) {
  const body = (
    <View style={styles.body}>
      {title || action ? (
        <View style={styles.titleRow}>
          {title ? <Text style={styles.screenTitle}>{title}</Text> : <View />}
          {action}
        </View>
      ) : null}
      {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );

  return (
    <ImageBackground source={PAPER} resizeMode="repeat" style={styles.paper}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </SafeAreaView>
    </ImageBackground>
  );
}

/** Material symbol on Android and web. */
export function Icon({
  name,
  size = 24,
  color = colors.text,
}: {
  name: AndroidSymbol;
  size?: number;
  color?: ColorValue;
}) {
  return <SymbolView name={{ android: name, web: name }} size={size} tintColor={color} />;
}

/** Icon-only control with a 48dp hit area and a spoken label. */
export function IconButton({
  name,
  label,
  onPress,
}: {
  name: AndroidSymbol;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
    >
      <Icon name={name} color={colors.textMuted} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

export function Amount({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' | 'lg' }) {
  return <Text style={[styles.amount, size === 'lg' && styles.amountLg, size === 'sm' && styles.amountSm]}>{value}</Text>;
}

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'secondary' && styles.buttonLabelSecondary,
          variant === 'danger' && styles.buttonLabelDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <View style={[styles.pill, toneTones[tone].bg]}>
      <Text style={[styles.pillLabel, toneTones[tone].fg]}>{label}</Text>
    </View>
  );
}

const toneTones = {
  neutral: { bg: { backgroundColor: colors.surfaceAlt }, fg: { color: colors.textMuted } },
  success: { bg: { backgroundColor: colors.successSoft }, fg: { color: colors.success } },
  warning: { bg: { backgroundColor: colors.warningSoft }, fg: { color: colors.warning } },
  danger: { bg: { backgroundColor: colors.dangerSoft }, fg: { color: colors.danger } },
  info: { bg: { backgroundColor: colors.infoSoft }, fg: { color: colors.info } },
} as const;

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  required,
  maxLength,
  autoFocus,
}: {
  label: string;
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'decimal-pad';
  secureTextEntry?: boolean;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoFocus={autoFocus}
        style={styles.input}
        autoCorrect={false}
      />
    </View>
  );
}

export function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.buttonPressed]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <Text style={styles.empty}>{message}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Stub({ note }: { note: string }) {
  return (
    <View style={styles.stub}>
      <Text style={styles.stubText}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  scroll: { paddingBottom: spacing.xxl },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  iconButton: {
    minWidth: touch.minWidth,
    minHeight: touch.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  screenTitle: { fontSize: typeScale.title, fontWeight: '700', color: colors.text, flexShrink: 1 },
  screenSubtitle: { fontSize: typeScale.body, color: colors.textMuted, marginTop: -spacing.sm },
  sectionTitle: {
    fontSize: typeScale.label,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  rowLabel: { fontSize: typeScale.body, color: colors.textMuted, flexShrink: 1 },
  rowValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '500' },
  rowValueStrong: { fontWeight: '700' },
  amount: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  amountLg: { fontSize: typeScale.display },
  amountSm: { fontSize: typeScale.body },
  button: {
    minHeight: touch.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonPressed: { opacity: 0.6 },
  buttonLabel: { color: colors.primaryText, fontSize: typeScale.body, fontWeight: '700' },
  buttonLabelSecondary: { color: colors.text },
  buttonLabelDanger: { color: colors.primaryText },
  pill: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.xxs, borderRadius: radii.pill },
  pillLabel: { fontSize: typeScale.caption, fontWeight: '700' },
  empty: { fontSize: typeScale.body, color: colors.textMuted, paddingVertical: spacing.sm },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  input: {
    minHeight: touch.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.body,
    color: colors.text,
  },
  choice: {
    minHeight: touch.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  choiceLabel: { fontSize: typeScale.body, color: colors.text },
  choiceLabelSelected: { color: colors.primaryInk, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  stub: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  stubText: { fontSize: typeScale.caption, color: colors.textMuted },
});
