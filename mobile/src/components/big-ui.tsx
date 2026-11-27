// The picture-first building blocks: big pressable tiles, product tiles, and a
// bottom sheet. Built on React Native and reanimated only (no new packages).
//
// Motion rules (see the ux-overhaul thread): feedback on finger-down, scale to
// 0.97 and back, nothing scales from zero, sheets rise from the bottom and leave
// the same way, and with reduce motion on only opacity changes.
import type { AndroidSymbol } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { productIcon, tintSlot } from '@/lib/product-visual';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, tileTints, touch, typeScale } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * A Pressable that shrinks a little the moment a finger lands and springs back
 * on release, so a big target feels pressed even before the screen changes.
 * With reduce motion on it dims instead of moving.
 */
export function PressScale({
  onPress,
  disabled,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityActions,
  onAccessibilityAction,
}: {
  /** Extra TalkBack actions, for a control drawn inside the tile (e.g. "remove one"). */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'link';
}) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: 1 - pressed.value * 0.15 }
      : { transform: [{ scale: 1 - pressed.value * 0.03 }] }
  );

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 100, easing: EASE_OUT });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 160, easing: EASE_OUT });
      }}
      android_ripple={{ color: colors.ripple }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * A big square-ish tile: one picture, at most three words. `primary` is the
 * filled blue used for the main action on a screen; everything else is paper.
 */
export function BigTile({
  icon,
  label,
  onPress,
  tone = 'plain',
  hint,
}: {
  icon: AndroidSymbol;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain';
  hint?: string;
}) {
  const primary = tone === 'primary';
  return (
    <PressScale
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={[styles.tile, primary ? styles.tilePrimary : styles.tilePlain]}
    >
      <View style={[styles.tileIcon, primary ? styles.tileIconPrimary : styles.tileIconPlain]}>
        <Icon name={icon} size={iconSize.xl} color={primary ? colors.primaryText : colors.primaryInk} />
      </View>
      {/* Two lines before shrinking: three tiles across a small phone, and Nyanja runs longer. */}
      <Text style={[styles.tileLabel, primary && styles.tileLabelPrimary]} numberOfLines={2} adjustsFontSizeToFit>
        {label}
      </Text>
    </PressScale>
  );
}

/**
 * Stands in for a product photo: a tinted square with an icon for what the
 * product is. Decorative, so screen readers skip it and read the name instead.
 */
export function ProductTile({
  id,
  name,
  category,
  size = touch.big,
}: {
  id: string;
  name: string;
  category?: string | null;
  size?: number;
}) {
  const tints = tileTints();
  const tint = tints[tintSlot(id, tints.length)];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.product, { width: size, height: size, backgroundColor: tint.bg }]}
    >
      <Icon name={productIcon(category, name)} size={Math.round(size * 0.5)} color={tint.fg} />
    </View>
  );
}

/**
 * A sheet that rises from the bottom, within thumb reach. Tap the dim area,
 * the Android back button or the close button to leave; it slides back down
 * the way it came. With reduce motion on it only fades.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  closeLabel,
  children,
  onClosed,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called once the sheet has fully left, so another Modal can open without overlapping it. */
  onClosed?: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  // Stays mounted while the closing animation plays. Mounting happens during
  // render when `visible` turns on, so the sheet is there to animate in.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  // Unknown until the sheet is laid out; it stays invisible until then so the
  // first frame never shows it in a guessed position.
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(0);
  // The latest callback, read when the exit animation ends rather than when it starts.
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  function finishClose() {
    setMounted(false);
    onClosedRef.current?.();
  }

  useEffect(() => {
    if (visible) {
      progress.value = reduceMotion
        ? withTiming(1, { duration: 200 })
        : withSpring(1, { duration: 350, dampingRatio: 1 });
    } else if (mounted) {
      // Leaving is quicker than arriving.
      progress.value = withTiming(0, { duration: 200, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
    }
    // `mounted` is read, not a trigger: only `visible` drives the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion, progress]);

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheet = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: height > 0 ? progress.value : 0 }
      : { opacity: height > 0 ? 1 : 0, transform: [{ translateY: (1 - progress.value) * height }] }
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
          {/* Tap outside to close. TalkBack skips it: the close button and Back do the same. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} importantForAccessibility="no" accessible={false} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }, sheet]}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={8}
              android_ripple={{ color: colors.ripple, borderless: true }}
              style={styles.sheetClose}
            >
              <Icon name="close" size={iconSize.lg} color={colors.text} />
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    tile: {
      flex: 1,
      minHeight: touch.big * 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.lg,
      borderRadius: radii.xl,
      overflow: 'hidden',
    },
    tilePlain: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation.card,
    },
    tilePrimary: { backgroundColor: colors.primary, ...elevation.raised },
    tileIcon: { width: touch.big, height: touch.big, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
    tileIconPlain: { backgroundColor: colors.primarySoft },
    tileIconPrimary: { backgroundColor: colors.onPrimaryTint },
    tileLabel: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, textAlign: 'center' },
    tileLabelPrimary: { color: colors.primaryText },
    product: { borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
    sheetRoot: { flex: 1, justifyContent: 'flex-end' },
    scrim: { backgroundColor: colors.scrim },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.md,
      ...elevation.raised,
    },
    handle: {
      alignSelf: 'center',
      width: spacing.xxl + spacing.sm,
      height: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: colors.border,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    sheetTitle: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text },
    sheetClose: {
      width: touch.minWidth,
      height: touch.minHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.pill,
    },
  })
);
