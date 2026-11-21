import { StyleSheet, Text, type TextStyle, type StyleProp } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

/**
 * The StockSure mark: a squared S drawn like shelving, ending in a blue dot.
 * Drawn on a 96 x 96 grid. The path and dot are shared with the animated
 * splash so the two can never drift apart.
 */
export const MARK_VIEWBOX = '0 0 96 96';
export const MARK_S_PATH =
  'M74 20 H34 a12 12 0 0 0 -12 12 v2 a12 12 0 0 0 12 12 H62 a12 12 0 0 1 12 12 v2 a12 12 0 0 1 -12 12 H36';
export const MARK_STROKE = 12;
export const MARK_DOT = { cx: 20, cy: 72, r: 7 } as const;

export function BrandMark({
  size = 72,
  ink = colors.charcoal,
  accent = colors.primary,
}: {
  size?: number;
  ink?: string;
  accent?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEWBOX} accessibilityLabel="StockSure">
      <Path d={MARK_S_PATH} fill="none" stroke={ink} strokeWidth={MARK_STROKE} strokeLinejoin="round" />
      <Circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill={accent} />
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
