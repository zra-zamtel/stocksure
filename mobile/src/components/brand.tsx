import { StyleSheet, Text, type TextStyle, type StyleProp } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

/**
 * The StockSure mark, "Stack & Check": two crates of stock with a blue tick
 * rising out of them. Drawn on a 96 x 96 grid. The shapes are shared with the
 * animated splash so the two can never drift apart.
 */
export const MARK_VIEWBOX = '0 0 96 96';
export const MARK = {
  bottom: { x: 14, y: 62, width: 68, height: 22, rx: 5 },
  slot: { x: 40, y: 70, width: 16, height: 5, rx: 2.5 },
  top: { x: 22, y: 42, width: 52, height: 16, rx: 4 },
  tick: 'M28 22 L41 34 L70 8',
  /** Length of the tick path: two straight strokes, about 17.7 + 38.9. */
  tickLength: 57,
  tickWidth: 10,
} as const;

export function BrandMark({
  size = 72,
  ink = colors.charcoal,
  accent = colors.primary,
  knock = colors.bg,
}: {
  size?: number;
  /** The crates. */
  ink?: string;
  /** The tick. */
  accent?: string;
  /** The handle slot cut into the bottom crate: the colour behind the mark. */
  knock?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEWBOX} accessibilityLabel="StockSure">
      <Rect {...MARK.bottom} fill={ink} />
      <Rect {...MARK.slot} fill={knock} />
      <Rect {...MARK.top} fill={ink} />
      <Path
        d={MARK.tick}
        fill="none"
        stroke={accent}
        strokeWidth={MARK.tickWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** "StockSure" with "Sure" in blue. Falls back to the system bold if the font is not loaded. */
export function Wordmark({ size = 32, style }: { size?: number; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      style={[styles.word, { fontSize: size, letterSpacing: -size * 0.02 }, style]}
      accessibilityRole="header"
      accessibilityLabel="StockSure"
    >
      Stock<Text style={styles.sure}>Sure</Text>
    </Text>
  );
}

export const WORDMARK_FONT = 'SpaceGrotesk_700Bold';

const styles = StyleSheet.create({
  word: { fontFamily: WORDMARK_FONT, color: colors.charcoal },
  sure: { color: colors.primaryInk },
});
