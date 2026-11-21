import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import type { AndroidSymbol } from 'expo-symbols';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import MATERIAL_SYMBOLS from '../theme/material-symbols.json';
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

/** The Material Symbols font, loaded once at start-up in the root layout. */
export const ICON_FONT = 'MaterialSymbols_400Regular';
const GLYPHS = MATERIAL_SYMBOLS as Record<string, number>;

/**
 * Material symbol on Android and web, drawn as one glyph of the icon font.
 * expo-symbols loads the font separately inside every icon and draws nothing
 * until that finishes, which on some phones is never; the root layout loads it
 * once before the splash lifts instead, and release builds embed it.
 */
export function Icon({
  name,
  size = 24,
  color = colors.text,
}: {
  name: AndroidSymbol;
  size?: number;
  color?: ColorValue;
}) {
  const code = GLYPHS[name];
  return (
    <Text
      accessible={false}
      importantForAccessibility="no"
      allowFontScaling={false}
      style={[styles.icon, { width: size, height: size, fontSize: size, lineHeight: size, color }]}
    >
      {code ? String.fromCodePoint(code) : ''}
    </Text>
  );
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
  /** Shows a spinner beside the label and blocks taps while work is running. */
  loading?: boolean;
  /** A symbol before the label. */
  icon?: AndroidSymbol;
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, icon }: ButtonProps) {
  const ink = variant === 'secondary' ? colors.text : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && styles.buttonPressed,
        loading && styles.buttonLoading,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={ink} /> : null}
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
  autoCapitalize,
  icon,
  prefix,
  revealLabels,
  hint,
  error,
}: {
  label: string;
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'decimal-pad' | 'email-address';
  secureTextEntry?: boolean;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** A symbol inside the box, before the text. */
  icon?: AndroidSymbol;
  /** Fixed text in a tinted segment before the input, e.g. a dialling code. */
  prefix?: string;
  /** With secureTextEntry: adds an eye button that shows the typed value. */
  revealLabels?: { show: string; hide: string };
  /** One line under the box that says what to type and why. */
  hint?: string;
  /** Replaces the hint in red and outlines the box, so the owner sees which field to fix. */
  error?: string | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const canReveal = Boolean(secureTextEntry && revealLabels);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <View style={[styles.inputBox, error ? styles.inputBoxError : null]}>
        {prefix ? (
          <View style={styles.inputPrefix}>
            <Text style={styles.inputPrefixText}>{prefix}</Text>
          </View>
        ) : null}
        {icon ? (
          <View style={styles.inputIcon}>
            <Icon name={icon} size={20} color={colors.textMuted} />
          </View>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry && !revealed}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' ? 'none' : undefined)}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          style={[styles.input, (icon || prefix) && styles.inputAfterLead]}
          autoCorrect={false}
        />
        {canReveal && revealLabels ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? revealLabels.hide : revealLabels.show}
            onPress={() => setRevealed((current) => !current)}
            style={({ pressed }) => [styles.inputReveal, pressed && styles.buttonPressed]}
          >
            <Icon name={revealed ? 'visibility' : 'visibility_off'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.fieldMessage} accessibilityLiveRegion="polite">
          <Text style={[styles.fieldMessageText, styles.fieldErrorText]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.fieldMessageText}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** An inline text action, e.g. "Already have an account? Sign in". */
export function TextLink({
  lead,
  label,
  onPress,
  accent,
}: {
  lead?: string;
  label: string;
  onPress: () => void;
  /** Blue link text, for small actions such as "Forgot your PIN?". */
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={lead ? `${lead} ${label}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.textLink, pressed && styles.buttonPressed]}
    >
      <Text style={styles.textLinkLead}>
        {lead ? `${lead} ` : ''}
        <Text style={[styles.textLinkLabel, accent && styles.textLinkAccent]}>{label}</Text>
      </Text>
    </Pressable>
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
      {selected ? (
        <View style={styles.choiceCheck}>
          <Icon name="check" size={20} color={colors.primaryInk} />
        </View>
      ) : null}
    </Pressable>
  );
}

type StateAction = { label: string; onPress: () => void; icon?: AndroidSymbol };

/**
 * What a screen shows when there is nothing to list. Without an icon or title
 * it is one quiet line (for small gaps inside a card). With them it becomes a
 * full panel that says what this place is for and offers the one next step,
 * so an owner on their own is never left looking at a blank screen.
 */
export function EmptyState({
  message,
  title,
  icon,
  action,
  secondary,
  tone = 'neutral',
}: {
  message: string;
  title?: string;
  icon?: AndroidSymbol;
  action?: StateAction;
  secondary?: StateAction;
  tone?: 'neutral' | 'success';
}) {
  if (!title && !icon) return <Text style={styles.empty}>{message}</Text>;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.statePanel}>
      {title ? (
        <Text style={styles.stateTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text style={styles.stateMessage}>{message}</Text>
      {action || secondary ? (
        <View style={styles.stateActions}>
          {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} /> : null}
          {secondary ? (
            <Button label={secondary.label} icon={secondary.icon} variant="secondary" onPress={secondary.onPress} />
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Shown when a read failed. It says it in plain words, keeps the technical
 * detail small underneath for whoever helps the owner, and always offers a retry.
 */
export function ErrorState({
  title,
  message,
  detail,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  detail?: string | null;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.statePanel} accessibilityLiveRegion="polite">
      <Text style={styles.stateTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.stateMessage}>{message}</Text>
      <View style={styles.stateActions}>
        <Button label={retryLabel} icon="refresh" onPress={onRetry} />
      </View>
      {detail ? <Text style={styles.stateDetail}>{detail}</Text> : null}
    </Animated.View>
  );
}

/**
 * A grey block that gently pulses where content is about to appear, so the
 * layout does not jump when it arrives. Static when the phone asks for less motion.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = radii.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt }, animated, style]}
    />
  );
}

/** A card-shaped placeholder: a heading line and a couple of body lines. */
export function SkeletonCard({ lines = 2, tall }: { lines?: number; tall?: boolean }) {
  return (
    <View style={styles.card}>
      <Skeleton width="45%" height={tall ? 28 : 18} />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '60%' : '85%'} height={12} />
      ))}
    </View>
  );
}

/** A screen-sized loading placeholder, announced once to screen readers. */
export function LoadingList({ label, count = 3, hero }: { label: string; count?: number; hero?: boolean }) {
  return (
    <View style={styles.loadingList} accessible accessibilityLabel={label} accessibilityRole="progressbar">
      {hero ? <SkeletonCard tall lines={1} /> : null}
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

/** A red box for a problem that is not about one field, e.g. no internet. */
export function FormError({ message }: { message: string }) {
  return (
    <View style={[styles.helpTip, styles.formError]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={[styles.helpTipText, styles.formErrorText]}>{message}</Text>
    </View>
  );
}

/** A tinted box with an info symbol: one short "why" or "how" beside a step. */
export function HelpTip({ children, icon = 'lightbulb' }: { children: ReactNode; icon?: AndroidSymbol }) {
  return (
    <View style={styles.helpTip}>
      <Text style={styles.helpTipText}>{children}</Text>
    </View>
  );
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
  icon: { fontFamily: ICON_FONT, textAlign: 'center', includeFontPadding: false },
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
  // The value may wrap but never pushes the label out: each side keeps room.
  rowValue: {
    fontSize: typeScale.body,
    color: colors.text,
    fontWeight: '500',
    flexShrink: 1,
    maxWidth: '62%',
    textAlign: 'right',
  },
  rowValueStrong: { fontWeight: '700' },
  amount: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  amountLg: { fontSize: typeScale.display },
  amountSm: { fontSize: typeScale.body },
  button: {
    minHeight: touch.minHeight,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonPressed: { opacity: 0.6 },
  buttonLoading: { opacity: 0.85 },
  buttonLabel: { color: colors.primaryText, fontSize: typeScale.body, fontWeight: '700' },
  buttonLabelSecondary: { color: colors.text },
  buttonLabelDanger: { color: colors.primaryText },
  pill: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.xxs, borderRadius: radii.pill },
  pillLabel: { fontSize: typeScale.caption, fontWeight: '700' },
  empty: { fontSize: typeScale.body, color: colors.textMuted, paddingVertical: spacing.sm },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  inputBox: {
    minHeight: touch.minHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  inputBoxError: { borderColor: colors.danger, borderWidth: 2 },
  fieldMessage: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  fieldMessageText: { flexShrink: 1, fontSize: typeScale.label, lineHeight: 18, color: colors.textMuted },
  fieldErrorText: { color: colors.danger, fontWeight: '600' },
  statePanel: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stateTitle: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, textAlign: 'center' },
  stateMessage: { fontSize: typeScale.body, lineHeight: 22, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  stateActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  stateDetail: { fontSize: typeScale.caption, color: colors.textMuted, textAlign: 'center' },
  loadingList: { gap: spacing.md },
  helpTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.infoSoft,
  },
  formError: { backgroundColor: colors.dangerSoft },
  formErrorText: { color: colors.danger, fontWeight: '600' },
  helpTipText: { flex: 1, fontSize: typeScale.label, lineHeight: 19, color: colors.info },
  input: {
    flex: 1,
    minHeight: touch.minHeight,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.body,
    color: colors.text,
  },
  inputAfterLead: { paddingLeft: spacing.sm },
  inputIcon: { justifyContent: 'center', paddingLeft: spacing.md },
  inputPrefix: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  inputPrefixText: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  inputReveal: { width: touch.minWidth, alignItems: 'center', justifyContent: 'center' },
  textLink: { minHeight: touch.minHeight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  textLinkLead: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center' },
  textLinkLabel: { color: colors.text, fontWeight: '700' },
  textLinkAccent: { color: colors.primaryInk },
  choiceCheck: { position: 'absolute', right: spacing.lg, top: 0, bottom: 0, justifyContent: 'center' },
  choice: {
    minHeight: touch.minHeight,
    borderRadius: radii.pill,
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
