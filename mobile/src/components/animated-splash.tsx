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
import Svg, { G, Path, Rect } from 'react-native-svg';
import { MARK, MARK_VIEWBOX, Wordmark } from './brand';
import { useI18n } from '../i18n';
import { colors, spacing, typeScale } from '../theme/tokens';

// Keep the native splash (plain paper, no image) up until this overlay has
// painted, so the hand-over is invisible. Called once, at import time.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Ease in and out, for the tick being drawn. */
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** A little overshoot, for a crate landing. */
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

type MarkProgress = { bottom: number; top: number; tick: number };

/**
 * How far each part of the mark has come (0 to 1): the bottom crate rises
 * into place, the top crate drops onto it, then the tick is drawn. Driven by a
 * plain animation-frame clock so the SVG gets ordinary props each frame:
 * animating SVG props through Reanimated left the mark undrawn on some phones.
 */
function useMarkProgress(timing: Timing, still: boolean): MarkProgress {
  const [progress, setProgress] = useState<MarkProgress>(() =>
    still ? { bottom: 1, top: 1, tick: 1 } : { bottom: 0, top: 0, tick: 0 },
  );
  useEffect(() => {
    if (still) return;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const elapsed = Date.now() - start;
      const bottom = clamp01((elapsed - timing.bottom) / timing.crateLen);
      const top = clamp01((elapsed - timing.top) / timing.crateLen);
      const stroke = clamp01((elapsed - timing.tick) / timing.tickLen);
      setProgress({ bottom, top, tick: stroke });
      if (stroke < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still, timing]);
  return progress;
}

const SEEN_KEY = 'stocksure.splashSeen';

/**
 * Timings in ms. The full version plays on the first launch; after that the
 * same story runs at about half the length, because an owner opening the app to
 * record a sale should not wait for a logo.
 */
const TIMINGS = {
  full: { bottom: 150, top: 450, crateLen: 350, tick: 800, tickLen: 600, word: 1450, wordLen: 450, tag: 1700, min: 2500 },
  short: { bottom: 0, top: 150, crateLen: 200, tick: 350, tickLen: 350, word: 650, wordLen: 300, tag: 750, min: 1300 },
} as const;
type Timing = (typeof TIMINGS)[keyof typeof TIMINGS];
const EXIT_MS = 280;

function readSeen() {
  try {
    return Storage.getItemSync(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The StockSure splash: the crates stack up, the blue tick is drawn, then the name
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
        {/* Bottom crate rises 10 units into place; top crate drops 14 onto it. */}
        <G opacity={mark.bottom} transform={`translate(0 ${10 * (1 - easeOutBack(mark.bottom))})`}>
          <Rect {...MARK.bottom} fill={colors.charcoal} />
          <Rect {...MARK.slot} fill={colors.bg} />
        </G>
        <G opacity={mark.top} transform={`translate(0 ${-14 * (1 - easeOutBack(mark.top))})`}>
          <Rect {...MARK.top} fill={colors.charcoal} />
        </G>
        {mark.tick > 0 ? (
          <Path
            d={MARK.tick}
            fill="none"
            stroke={colors.primary}
            strokeWidth={MARK.tickWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[MARK.tickLength, MARK.tickLength]}
            strokeDashoffset={MARK.tickLength * (1 - easeInOutCubic(mark.tick))}
          />
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
