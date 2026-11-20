import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { niceTicks } from '@/core';
import { Icon } from './ui';
import { chart, colors, radii, spacing, touch, typeScale } from '../theme/tokens';

/**
 * Small chart kit for the Insights screen, built from plain views so it needs
 * no native chart library. Specs follow the dataviz guide: bars at most 24px
 * thick with a 4px rounded data end and a square baseline, hairline solid
 * gridlines, values in text ink (never the series colour), one highlighted
 * mark against a lighter step of the same blue.
 */

const BAR_MAX = 24;
const GAP = 2;

/** Short axis labels: in full under 10,000, compact (12K) above. */
export function compactNumber(value: number): string {
  if (Math.abs(value) < 10_000) return new Intl.NumberFormat('en-ZM').format(Math.round(value));
  if (Math.abs(value) < 1_000_000) return `${Math.round(value / 1000)}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/* ------------------------------------------------------------------ */
/* Column chart                                                         */
/* ------------------------------------------------------------------ */

export interface ColumnPoint {
  key: string;
  /** Under the column; pass '' to leave a slot unlabelled. */
  label: string;
  value: number;
  /** Spoken label and the readout shown when the column is tapped. */
  describe: string;
}

/**
 * Vertical columns on one baseline. Tapping a column highlights it and shows
 * its figures in the readout above; that is the touch version of a hover
 * tooltip. The highlighted column starts on `initialIndex`.
 */
export function ColumnChart({
  points,
  initialIndex,
  height = 150,
  formatTick,
}: {
  points: ColumnPoint[];
  initialIndex: number;
  height?: number;
  formatTick: (value: number) => string;
}) {
  const [selected, setSelected] = useState(initialIndex);
  const [lastInitial, setLastInitial] = useState(initialIndex);
  // A new data set (another period) resets the highlight to its default.
  if (lastInitial !== initialIndex) {
    setLastInitial(initialIndex);
    setSelected(initialIndex);
  }
  const [plotWidth, setPlotWidth] = useState(0);
  const max = Math.max(0, ...points.map((point) => point.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const slot = points.length > 0 ? plotWidth / points.length : 0;
  const barWidth = Math.max(2, Math.min(BAR_MAX, slot - GAP));
  const current = points[selected];

  return (
    <View style={styles.columnChart}>
      <View style={styles.readout} accessibilityLiveRegion="polite">
        <Text style={styles.readoutText} numberOfLines={1}>
          {current?.describe ?? ''}
        </Text>
      </View>
      <View style={styles.columnBody}>
        <View style={[styles.yAxis, { height }]}>
          {ticks.map((tick) => (
            <Text key={tick} style={[styles.tick, { bottom: (tick / top) * height - 7 }]}>
              {formatTick(tick)}
            </Text>
          ))}
        </View>
        <View style={styles.plotColumn}>
          <View
            style={[styles.plot, { height }]}
            onLayout={(event: LayoutChangeEvent) => setPlotWidth(event.nativeEvent.layout.width)}
          >
            {ticks.map((tick) => (
              <View
                key={tick}
                style={[styles.gridline, tick === 0 && styles.baseline, { bottom: (tick / top) * height }]}
              />
            ))}
            <View style={styles.columns}>
              {points.map((point, index) => (
                <Pressable
                  key={point.key}
                  accessibilityRole="button"
                  accessibilityLabel={point.describe}
                  accessibilityState={{ selected: index === selected }}
                  onPress={() => setSelected(index)}
                  style={styles.slot}
                >
                  <Column
                    height={(Math.max(0, point.value) / top) * height}
                    width={barWidth}
                    highlighted={index === selected}
                    delay={Math.min(index * 12, 240)}
                  />
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.xAxis}>
            {points.map((point) => (
              <Text key={point.key} style={styles.xLabel} numberOfLines={1}>
                {point.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function Column({ height, width, highlighted, delay }: { height: number; width: number; highlighted: boolean; delay: number }) {
  const grown = useSharedValue(0);
  useEffect(() => {
    grown.value = withDelay(delay, withTiming(height, { duration: 420 }));
  }, [delay, grown, height]);
  const style = useAnimatedStyle(() => ({ height: grown.value }));

  return (
    <Animated.View
      style={[
        styles.column,
        { width, backgroundColor: highlighted ? chart.accent : chart.muted },
        height > 0 && height < 4 ? styles.columnThin : null,
        style,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Ranked horizontal bars                                               */
/* ------------------------------------------------------------------ */

export interface RankedItem {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  /** A short line under the bar, e.g. "3 sold". */
  note?: string;
  /** Marks a row that needs attention; shown with an icon and words. */
  flag?: { label: string; tone: 'warning' | 'danger' };
}

/** One bar per row, largest first, all one hue; the figure sits at the row's end. */
export function RankedBars({ items }: { items: RankedItem[] }) {
  const max = Math.max(1, ...items.map((item) => Math.max(0, item.value)));
  return (
    <View style={styles.ranked}>
      {items.map((item, index) => (
        <View
          key={item.key}
          style={styles.rankRow}
          accessible
          accessibilityLabel={[item.label, item.valueLabel, item.note, item.flag?.label].filter(Boolean).join(', ')}
        >
          <View style={styles.rankHead}>
            <Text style={styles.rankLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={styles.rankValue}>{item.valueLabel}</Text>
          </View>
          <RankBar fraction={Math.max(0, item.value) / max} delay={index * 60} />
          {item.note || item.flag ? (
            <View style={styles.rankFoot}>
              {item.note ? <Text style={styles.rankNote}>{item.note}</Text> : null}
              {item.flag ? <Flag {...item.flag} /> : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function RankBar({ fraction, delay }: { fraction: number; delay: number }) {
  const grown = useSharedValue(0);
  useEffect(() => {
    grown.value = withDelay(delay, withTiming(fraction, { duration: 480 }));
  }, [delay, fraction, grown]);
  const style = useAnimatedStyle(() => ({ width: `${grown.value * 100}%` }));
  return (
    <View style={styles.rankTrack}>
      <Animated.View style={[styles.rankBar, fraction > 0 && styles.rankBarMin, style]} />
    </View>
  );
}

export function Flag({ label, tone }: { label: string; tone: 'warning' | 'danger' }) {
  const ink = tone === 'danger' ? colors.danger : colors.warning;
  return (
    <View style={[styles.flag, { backgroundColor: tone === 'danger' ? colors.dangerSoft : colors.warningSoft }]}>
      <Icon name={tone === 'danger' ? 'error' : 'warning'} size={14} color={ink} />
      <Text style={[styles.flagText, { color: ink }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Tall segmented bar                                                   */
/* ------------------------------------------------------------------ */

export interface Segment {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  /** Categorical slot, fixed per entity so a colour always means one thing. */
  slot: number;
}

/**
 * One whole split into parts: a 28px bar of blocks with 2px gaps, the share
 * printed inside a block when it fits, and a legend that lists every part
 * with its amount and share, so colour is never the only key.
 */
export function SegmentedBar({ segments }: { segments: Segment[] }) {
  const [width, setWidth] = useState(0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const usable = width - GAP * Math.max(0, segments.length - 1);

  return (
    <View style={styles.segmented}>
      <View
        style={styles.segmentBar}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={segments.map((s) => `${s.label} ${s.valueLabel}, ${share(s.value)}%`).join('; ')}
      >
        {width > 0
          ? segments.map((segment) => {
              // Widths come from flex weights so the blocks always fill the bar
              // exactly; the measured width only decides whether a label fits.
              const blockWidth = total > 0 ? (segment.value / total) * usable : 0;
              const text = `${share(segment.value)}%`;
              const labelled = blockWidth >= 40;
              return (
                <View
                  key={segment.key}
                  style={[
                    styles.segment,
                    labelled && styles.segmentLabelled,
                    { flexGrow: segment.value, flexBasis: 0, backgroundColor: chart.series[segment.slot] },
                  ]}
                >
                  {labelled ? (
                    <Text style={[styles.segmentText, { color: chart.seriesInk[segment.slot] }]}>{text}</Text>
                  ) : null}
                </View>
              );
            })
          : null}
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: chart.series[segment.slot] }]} />
            <Text style={styles.legendLabel}>{segment.label}</Text>
            <Text style={styles.legendValue}>{segment.valueLabel}</Text>
            <Text style={styles.legendShare}>{share(segment.value)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile, toggle, chart card                                        */
/* ------------------------------------------------------------------ */

/**
 * Label, value and change against the previous period. Up is good for every
 * figure on this screen, so green means up and red means down, and an arrow
 * and the words say the same thing for anyone who cannot see the colour.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  hint,
}: {
  label: string;
  value: string;
  /** Fractional change, or null when there is nothing to compare with. */
  delta: number | null;
  /** E.g. "vs last 7 days"; or the reason there is no change. */
  deltaLabel: string;
  hint?: string;
}) {
  const up = delta !== null && delta > 0.005;
  const down = delta !== null && delta < -0.005;
  const tone = up ? colors.success : down ? colors.danger : colors.textMuted;
  const percent = delta === null ? null : `${Math.round(Math.abs(delta) * 100)}%`;
  return (
    <View style={styles.tile} accessible accessibilityLabel={[label, value, percent ? `${up ? '+' : down ? '-' : ''}${percent} ${deltaLabel}` : deltaLabel, hint].filter(Boolean).join(', ')}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
      <View style={styles.tileDelta}>
        {percent ? (
          <>
            <Icon name={up ? 'arrow_upward' : down ? 'arrow_downward' : 'arrow_forward'} size={14} color={tone} />
            <Text style={[styles.tileDeltaText, { color: tone }]}>{percent}</Text>
          </>
        ) : null}
        <Text style={[styles.tileDeltaLabel, !percent && styles.tileDeltaLabelAlone]} numberOfLines={2}>
          {deltaLabel}
        </Text>
      </View>
    </View>
  );
}

/** A row of mutually exclusive pills, e.g. 7 days | 30 days. */
export function Toggle<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.toggleItem, active && styles.toggleItemActive]}
          >
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A titled card holding one chart and the one-line takeaway under its title. */
export function ChartCard({
  title,
  takeaway,
  control,
  children,
}: {
  title: string;
  takeaway?: string;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {takeaway ? <Text style={styles.cardTakeaway}>{takeaway}</Text> : null}
      </View>
      {control}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Column chart
  columnChart: { gap: spacing.sm },
  readout: { minHeight: 20, justifyContent: 'center' },
  readoutText: { fontSize: typeScale.label, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  columnBody: { flexDirection: 'row', gap: spacing.xs },
  yAxis: { width: 40 },
  tick: {
    position: 'absolute',
    right: 0,
    fontSize: 11,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  plotColumn: { flex: 1, gap: spacing.xs },
  plot: { position: 'relative' },
  gridline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: chart.grid },
  baseline: { height: 1, backgroundColor: chart.axis },
  columns: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'flex-end' },
  slot: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', minHeight: touch.minHeight },
  column: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  columnThin: { minHeight: 2 },
  xAxis: { flexDirection: 'row' },
  xLabel: { flex: 1, fontSize: 11, color: colors.textMuted, textAlign: 'center', overflow: 'visible' },

  // Ranked bars
  ranked: { gap: spacing.md },
  rankRow: { gap: spacing.xs },
  rankHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rankLabel: { flex: 1, fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  rankValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rankTrack: { height: 12 },
  rankBar: { height: 12, backgroundColor: chart.accent, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  rankBarMin: { minWidth: 3 },
  rankFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  rankNote: { fontSize: typeScale.label, color: colors.textMuted },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  flagText: { fontSize: typeScale.caption, fontWeight: '700' },

  // Segmented bar
  segmented: { gap: spacing.md },
  segmentBar: { height: 28, flexDirection: 'row', gap: GAP },
  segment: { height: 28, borderRadius: 4, justifyContent: 'center', minWidth: 2 },
  segmentLabelled: { paddingHorizontal: spacing.sm },
  segmentText: { fontSize: typeScale.caption, fontWeight: '700' },
  legend: { gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: typeScale.body, color: colors.text },
  legendValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  legendShare: {
    width: 44,
    textAlign: 'right',
    fontSize: typeScale.label,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  // Stat tile
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  tileLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  tileValue: { fontSize: typeScale.title, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  tileHint: { fontSize: typeScale.caption, color: colors.textMuted },
  tileDelta: { flexDirection: 'row', alignItems: 'flex-start', gap: 2, marginTop: spacing.xxs },
  tileDeltaText: { fontSize: typeScale.caption, fontWeight: '800' },
  tileDeltaLabel: { fontSize: typeScale.caption, color: colors.textMuted, marginLeft: 2, flexShrink: 1 },
  tileDeltaLabelAlone: { marginLeft: 0 },

  // Toggle
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    padding: 3,
    alignSelf: 'flex-start',
  },
  toggleItem: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleItemActive: { backgroundColor: colors.charcoal },
  toggleText: { fontSize: typeScale.label, fontWeight: '700', color: colors.textMuted },
  toggleTextActive: { color: colors.primaryText },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { gap: spacing.xxs },
  cardTitle: { fontSize: typeScale.heading, fontWeight: '800', color: colors.text },
  cardTakeaway: { fontSize: typeScale.body, color: colors.textMuted, lineHeight: 21 },
});
