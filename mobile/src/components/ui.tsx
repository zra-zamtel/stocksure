import { memo, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { useI18n } from '../i18n';
import {
  ActivityIndicator,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { colors, currentScheme, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '../theme/tokens';

type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** One small action beside the title, such as the settings gear. */
  action?: ReactNode;
  /** A visible "Back" above the title, for pushed screens without their own close button. */
  back?: boolean;
  /**
   * Show "Back" even inside the tabs: for a tab route that is not in the bar
   * (Sales, Tax), which is reached from Home and needs a way out.
   */
  offBar?: boolean;
};

// A faint paper grain tiled under every screen, so the warm background reads as
// a material rather than a flat fill. It is a 128px tile, a few KB.
const PAPER = require('../../assets/images/paper.png');

/** Warm paper with grain in light mode; plain warm charcoal in dark mode. */
function Paper({ children }: { children: ReactNode }) {
  if (currentScheme() === 'dark') return <View style={styles.paper}>{children}</View>;
  return (
    <ImageBackground source={PAPER} resizeMode="repeat" style={styles.paper}>
      {children}
    </ImageBackground>
  );
}

// Steps in a fade. Plain views, not a gradient image, so every Android phone
// draws the same thing; 14 steps over ~60px is smooth on textured paper.
const FADE_STEPS = 14;

/**
 * Paper that fades from clear to solid toward one screen edge, with a fully
 * solid strip at that edge (behind the status bar or the tab bar), so the
 * chrome there always reads. It never takes touches.
 */
const PaperFade = memo(function PaperFade({
  fade,
  solid,
  edge,
}: {
  /** Height of the soft part, in px. */
  fade: number;
  /** Height of the solid part at the edge, in px. */
  solid: number;
  edge: 'top' | 'bottom';
}) {
  const step = fade / FADE_STEPS;
  const steps = Array.from({ length: FADE_STEPS }, (_, index) => {
    // Ease-in: barely there far from the edge, firm close to it.
    const t = (index + 1) / FADE_STEPS;
    return <View key={index} style={{ height: step, backgroundColor: colors.bg, opacity: t * t * 0.96 }} />;
  });
  const solidPart = <View style={{ height: solid, backgroundColor: colors.bg }} />;
  return (
    <View pointerEvents="none" style={edge === 'top' ? styles.fadeTop : styles.fadeBottom}>
      {edge === 'top' ? (
        <>
          {solidPart}
          {steps.reverse()}
        </>
      ) : (
        <>
          {steps}
          {solidPart}
        </>
      )}
    </View>
  );
});

/** True while the on-screen keyboard is up. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export function Screen({ title, subtitle, children, scroll = true, footer, action, back = false, offBar = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  // Inside the tabs the bar floats over the screen with no background of its
  // own; this screen draws the fade behind it. Elsewhere this is 0.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const [footerHeight, setFooterHeight] = useState(0);
  const router = useRouter();
  const { t } = useI18n();
  // Pushed screens (Add product, Record sale…) get a visible way back, not
  // only Android's back gesture. Tabs in the bar are top level, so they never
  // show it; tab routes kept off the bar (offBar) do.
  const showBack = (offBar || (back && tabBarHeight === 0)) && router.canGoBack();
  // The keyboard covers the tab bar and the phone's nav bar, so while it is up
  // the footer drops that space and sits straight on top of the keyboard.
  const keyboardVisible = useKeyboardVisible();
  // Content runs edge to edge, under the status bar and behind the footer and
  // tab bar; these pads only make sure the first and last items can be read.
  const bottomEdge = keyboardVisible ? 0 : tabBarHeight || insets.bottom;
  const bottomChrome = footer ? footerHeight : bottomEdge;
  // Solid behind the status bar and the tab bar (or the phone's own nav bar);
  // a soft fade above the floating footer button so content slides under it.
  const bottomSolid = bottomEdge;
  const bottomSoft = Math.max(bottomChrome - bottomSolid, 0) + spacing.xxl;

  const body = (
    <View style={[styles.body, { paddingTop: insets.top + spacing.lg }]}>
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.iconButtonPressed]}
        >
          <Icon name="arrow_back" size={iconSize.md} color={colors.text} />
          <Text style={styles.backLabel}>{t('common.back')}</Text>
        </Pressable>
      ) : null}
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
    <Paper>
      {/* The window does not shrink for the keyboard when the app draws edge to
          edge, so the content makes room itself: the field being typed in and the
          footer button stay above the keyboard. The inner view is what shrinks,
          so the floating footer and the fades move up with it. */}
      <KeyboardAvoidingView behavior="padding" style={styles.safe}>
        <View style={[styles.safe, { paddingLeft: insets.left, paddingRight: insets.right }]}>
          {scroll ? (
            <ScrollView
              contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {body}
            </ScrollView>
          ) : (
            <View style={[styles.safe, { paddingBottom: bottomChrome }]}>{body}</View>
          )}

          {/* Soft fades instead of hard edges, so content slides under the chrome. */}
          <PaperFade edge="top" solid={insets.top} fade={spacing.xl} />
          <PaperFade edge="bottom" solid={bottomSolid} fade={bottomSoft} />

          {footer ? (
            // The footer floats over the content: above the tab bar inside the
            // tabs, otherwise above Android's 3-button bar or gesture strip.
            <View
              style={[styles.footer, { paddingBottom: bottomEdge + spacing.md }]}
              onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Paper>
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
      android_ripple={{ color: colors.ripple, borderless: true, radius: 24 }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <Icon name={name} color={colors.text} />
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Makes the whole card one tap target, with ripple and pressed tint. */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.card, style, pressed && styles.cardPressed]}
    >
      {children}
    </Pressable>
  );
}

/** A small uppercase heading over a group, with an optional text action on the right. */
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onPress: () => void };
}) {
  if (!action) {
    return (
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {children}
      </Text>
    );
  }
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, styles.sectionTitleFlex]} accessibilityRole="header">
        {children}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={action.onPress}
        hitSlop={12}
        style={({ pressed }) => [styles.sectionAction, pressed && styles.buttonPressed]}
      >
        <Text style={styles.sectionActionText}>{action.label}</Text>
      </Pressable>
    </View>
  );
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<Tone, { bg: string; fg: string }> = themed(() => ({
  neutral: { bg: colors.surfaceAlt, fg: colors.text },
  primary: { bg: colors.primarySoft, fg: colors.primaryInk },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
}));

/** An icon on a soft tinted square: the lead of a row, a tile or a state panel. */
export function IconBadge({
  name,
  tone = 'primary',
  size = 40,
}: {
  name: AndroidSymbol;
  tone?: Tone;
  size?: number;
}) {
  const look = BADGE_TONES[tone];
  return (
    <View
      style={[
        styles.iconBadge,
        { width: size, height: size, borderRadius: size >= 56 ? size / 2 : radii.md, backgroundColor: look.bg },
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.55)} color={look.fg} />
    </View>
  );
}

/**
 * One number with a label under it, set side by side with its siblings. With
 * onPress it is a filter: the selected one gets a blue outline.
 */
export function StatTile({
  value,
  label,
  icon,
  tone = 'neutral',
  selected,
  onPress,
}: {
  value: string | number;
  label: string;
  icon?: AndroidSymbol;
  tone?: Tone;
  selected?: boolean;
  onPress?: () => void;
}) {
  const ink = tone === 'neutral' || tone === 'primary' ? colors.text : BADGE_TONES[tone].fg;
  const body = (
    <>
      <View style={styles.statTop}>
        <Text style={[styles.statValue, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {icon ? <Icon name={icon} size={iconSize.md} color={tone === 'neutral' ? colors.textMuted : ink} /> : null}
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.stat, selected && styles.statSelected, pressed && !selected && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * A list line: an optional icon badge, a title and a muted line, something on
 * the right (an amount, a pill), and a chevron when it opens somewhere. Rows
 * sit inside a ListGroup, which draws one card with hairlines between them.
 */
export function ListRow({
  title,
  meta,
  icon,
  iconTone,
  right,
  onPress,
  accessibilityLabel,
  last,
}: {
  title: string;
  meta?: string | null;
  icon?: AndroidSymbol;
  iconTone?: Tone;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  last?: boolean;
}) {
  const body = (
    <>
      {icon ? <IconBadge name={icon} tone={iconTone} size={40} /> : null}
      <View style={styles.listText}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.listMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.listRight}>{right}</View> : null}
      {onPress ? <Icon name="chevron_right" size={iconSize.md} color={colors.textMuted} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.listRow, pressed && styles.listPressed]}
    >
      {body}
    </Pressable>
  );
}

/** A run of ListRows, each its own card, separated by space rather than lines. */
export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={styles.listGroup}>{children}</View>;
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
      android_ripple={{ color: variant === 'secondary' ? colors.ripple : 'rgba(255, 255, 255, 0.18)' }}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        loading && styles.buttonLoading,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={ink} />
      ) : icon ? (
        <Icon name={icon} size={iconSize.md} color={ink} />
      ) : null}
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

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <View style={[styles.pill, toneTones[tone].bg]}>
      <Text style={[styles.pillLabel, toneTones[tone].fg]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const toneTones = themed(() => ({
  neutral: { bg: { backgroundColor: colors.surfaceAlt }, fg: { color: colors.textMuted } },
  primary: { bg: { backgroundColor: colors.primarySoft }, fg: { color: colors.primaryInk } },
  success: { bg: { backgroundColor: colors.successSoft }, fg: { color: colors.success } },
  warning: { bg: { backgroundColor: colors.warningSoft }, fg: { color: colors.warning } },
  danger: { bg: { backgroundColor: colors.dangerSoft }, fg: { color: colors.danger } },
  info: { bg: { backgroundColor: colors.infoSoft }, fg: { color: colors.info } },
}) as const);

/** A rounded search bar with a clear button, for filtering a list on screen. */
export function SearchField({
  value,
  onChangeText,
  label,
  clearLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  /** Shown as the hint inside the bar and read out by screen readers. */
  label: string;
  clearLabel: string;
}) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={20} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={() => onChangeText('')}
          hitSlop={12}
        >
          <Icon name="close" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

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
  trailing,
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
  /** Something inside the box after the text, e.g. the detected network's mark. */
  trailing?: ReactNode;
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
        {trailing ? <View style={styles.inputTrailing}>{trailing}</View> : null}
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
  icon,
  kind = 'radio',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** A symbol on the left; the row then reads left-aligned like a list option. */
  icon?: AndroidSymbol;
  /** 'checkbox' for an on/off option that does not exclude its siblings. */
  kind?: 'radio' | 'checkbox';
}) {
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={kind === 'checkbox' ? { checked: selected } : { selected }}
      onPress={onPress}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [
        styles.choice,
        icon && styles.choiceWithIcon,
        selected && styles.choiceSelected,
        pressed && styles.cardPressed,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize.md} color={selected ? colors.primaryInk : colors.textMuted} /> : null}
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
      {icon ? <IconBadge name={icon} tone={tone === 'success' ? 'success' : 'primary'} size={64} /> : null}
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
      <IconBadge name="cloud_off" tone="danger" size={64} />
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
      <Icon name="error" size={iconSize.md} color={colors.danger} />
      <Text style={[styles.helpTipText, styles.formErrorText]}>{message}</Text>
    </View>
  );
}

/** A tinted box with an info symbol: one short "why" or "how" beside a step. */
export function HelpTip({ children, icon = 'lightbulb' }: { children: ReactNode; icon?: AndroidSymbol }) {
  return (
    <View style={styles.helpTip}>
      <Icon name={icon} size={iconSize.md} color={colors.info} />
      <Text style={styles.helpTipText}>{children}</Text>
    </View>
  );
}

/** Extra breathing room between two parts of a card. Space, not a line. */
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

const styles = themed(() => StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.minHeight,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    ...elevation.card,
  },
  searchInput: {
    flex: 1,
    minHeight: touch.minHeight,
    fontSize: typeScale.body,
    color: colors.text,
  },
  icon: { fontFamily: ICON_FONT, textAlign: 'center', includeFontPadding: false },
  paper: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  fadeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: touch.minHeight,
    paddingRight: spacing.md,
    marginLeft: -spacing.xs,
  },
  backLabel: { fontSize: typeScale.body, fontWeight: '600', color: colors.text },
  iconButton: {
    minWidth: touch.minWidth,
    minHeight: touch.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconButtonPressed: { backgroundColor: colors.surfaceAlt },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: typeScale.display,
    lineHeight: typeScale.display + 6,
    letterSpacing: -0.4,
    color: colors.text,
    flexShrink: 1,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.md },
  sectionTitleFlex: { flex: 1, marginTop: 0 },
  sectionAction: { minHeight: 32, justifyContent: 'center' },
  sectionActionText: { fontSize: typeScale.label, fontWeight: '700', color: colors.primaryInk },
  cardPressed: { backgroundColor: colors.surfaceAlt },
  iconBadge: { alignItems: 'center', justifyContent: 'center' },
  stat: {
    flex: 1,
    minHeight: touch.minHeight + spacing.xl,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  statSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  statValue: { flexShrink: 1, fontFamily: fonts.display, fontSize: typeScale.title, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  listGroup: { gap: spacing.sm },
  listRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minHeight + spacing.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
  },
  listPressed: { backgroundColor: colors.surfaceAlt },
  listText: { flex: 1, gap: 2 },
  listTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  listMeta: { fontSize: typeScale.label, color: colors.textMuted },
  listRight: { alignItems: 'flex-end', gap: spacing.xs },
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
    ...elevation.card,
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
  amount: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  amountLg: { fontSize: typeScale.display },
  amountSm: { fontSize: typeScale.body },
  button: {
    // 56dp: the picture-first screens' primary actions, at a busy counter.
    minHeight: touch.big,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.dangerFill },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.45 },
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  stateTitle: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, textAlign: 'center' },
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
  inputTrailing: { justifyContent: 'center', paddingRight: spacing.sm },
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
  choiceWithIcon: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.md,
    borderRadius: radii.lg,
    minHeight: touch.minHeight + spacing.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  choiceSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  choiceLabel: { fontSize: typeScale.body, color: colors.text },
  choiceLabelSelected: { color: colors.primaryInk, fontWeight: '700' },
  divider: { height: spacing.md },
  stub: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  stubText: { fontSize: typeScale.caption, color: colors.textMuted },
}));
