import * as SplashScreen from 'expo-splash-screen';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { MARK_DOT, MARK_STROKE, MARK_S_PATH, MARK_VIEWBOX, Wordmark } from './brand';
import { useI18n } from '../i18n';
import { colors, spacing, typeScale } from '../theme/tokens';

// Keep the native splash (plain paper, no image) up until this overlay has
// painted, so the hand-over is invisible. Called once, at import time.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Ease in and out, for the pen stroke. */
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** A little overshoot, for the dot popping in. */
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
const DOT_MS = 320;

/**
 * Progress of the S stroke (0 to 1) and the dot (0 to ~1.1), driven by a plain
 * animation-frame clock. The SVG gets ordinary props each frame: animating
 * SVG props through Reanimated left the S undrawn on some Android phones.
 */
function useMarkProgress(timing: { drawDelay: number; draw: number; dot: number }, still: boolean) {
  const [progress, setProgress] = useState(() => (still ? { draw: 1, dot: 1 } : { draw: 0, dot: 0 }));
  useEffect(() => {
    if (still) return;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const elapsed = Date.now() - start;
      const draw = Math.min(1, Math.max(0, (elapsed - timing.drawDelay) / timing.draw));
      const dotT = Math.min(1, Math.max(0, (elapsed - timing.dot) / DOT_MS));
      setProgress({ draw: easeInOutCubic(draw), dot: dotT === 0 ? 0 : easeOutBack(dotT) });
      if (draw < 1 || dotT < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still, timing]);
  return progress;
}

/** Length of MARK_S_PATH in viewBox units: 94 straight + 4 vertical + 4 quarter arcs of r 12. */
const S_LENGTH = 174;
const SEEN_KEY = 'stocksure.splashSeen';

/**
 * Timings in ms. The full version plays on the first launch; after that the
 * same story runs at about half the length, because an owner opening the app to
 * record a sale should not wait for a logo.
 */
const TIMINGS = {
  full: { drawDelay: 150, draw: 1000, dot: 1150, word: 1450, wordLen: 450, tag: 1700, min: 2500 },
  short: { drawDelay: 0, draw: 500, dot: 500, word: 650, wordLen: 300, tag: 750, min: 1300 },
} as const;
const EXIT_MS = 280;

function readSeen() {
  try {
    return Storage.getItemSync(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The StockSure splash: the S draws itself, the blue dot pops in, then the name
 * and tagline rise. It stays until the app is `ready` (database and session
 * loaded) and the animation has played, then fades out to reveal the app.
 */
export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [timing] = useState(() => (readSeen() ? TIMINGS.short : TIMINGS.full));
  const [played, setPlayed] = useState(false);
  const exiting = useRef(false);

  const mark = useMarkProgress(timing, reduceMotion);
  const word = useSharedValue(reduceMotion ? 1 : 0);
  const tag = useSharedValue(reduceMotion ? 1 : 0);
  const screen = useSharedValue(1);

  useEffect(() => {
    if (!reduceMotion) {
      const rise = Easing.out(Easing.cubic);
      word.value = withDelay(timing.word, withTiming(1, { duration: timing.wordLen, easing: rise }));
      tag.value = withDelay(timing.tag, withTiming(1, { duration: timing.wordLen, easing: rise }));
    }
    const id = setTimeout(() => setPlayed(true), reduceMotion ? 600 : timing.min);
    try {
      Storage.setItemSync(SEEN_KEY, '1');
    } catch {
      // A missing flag only means the long version plays again.
    }
    return () => clearTimeout(id);
  }, [reduceMotion, tag, timing, word]);

  useEffect(() => {
    if (!ready || !played || exiting.current) return;
    exiting.current = true;
    screen.value = withTiming(0, { duration: EXIT_MS });
    const id = setTimeout(onDone, EXIT_MS);
    return () => clearTimeout(id);
  }, [onDone, played, ready, screen]);

  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: 14 * (1 - word.value) }],
  }));
  const tagStyle = useAnimatedStyle(() => ({
    opacity: tag.value,
    transform: [{ translateY: 10 * (1 - tag.value) }],
  }));
  const screenStyle = useAnimatedStyle(() => ({ opacity: screen.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.screen, screenStyle]}
      onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}
      accessibilityLabel={`StockSure. ${t('splash.tagline')}`}
      accessible
      pointerEvents={ready && played ? 'none' : 'auto'}
    >
      <Svg width={128} height={128} viewBox={MARK_VIEWBOX}>
        <Path
          d={MARK_S_PATH}
          fill="none"
          stroke={colors.charcoal}
          strokeWidth={MARK_STROKE}
          strokeLinejoin="round"
          strokeDasharray={[S_LENGTH, S_LENGTH]}
          strokeDashoffset={S_LENGTH * (1 - mark.draw)}
        />
        {mark.dot > 0 ? (
          <Circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r * mark.dot} fill={colors.primary} />
        ) : null}
      </Svg>
      <Animated.View style={wordStyle}>
        <Wordmark size={40} />
      </Animated.View>
      <Animated.View style={tagStyle}>
        <Text style={styles.tagline}>{t('splash.tagline')}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    zIndex: 10,
  },
  tagline: {
    fontSize: typeScale.body,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
});
