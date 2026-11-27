import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { TradingRecordPayload } from '@/lib/api';
import { formatKwacha } from '@/lib/format';
import { colors, iconSize, radii, spacing, themed, typeScale } from '@/theme/tokens';

type Tier = {
  key: 'momo' | 'cash' | 'recorded';
  value: number;
  icon: 'verified' | 'balance' | 'edit_note';
  ink: string;
  fill: string;
};

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part * 100) / whole)}%` : '—';
}

/**
 * Sales split by strength of evidence: three tiers that are never added into
 * one "verified" figure. Each tier has its own icon and label as well as a
 * colour, so the split reads without colour (and on a greyscale print).
 */
export function EvidenceBreakdown({ totals }: { totals: TradingRecordPayload['totals'] }) {
  const { t } = useI18n();
  const tiers: Tier[] = [
    { key: 'momo', value: totals.mobile_money_matched, icon: 'verified', ink: colors.success, fill: colors.success },
    { key: 'cash', value: totals.cash_balanced_close, icon: 'balance', ink: colors.info, fill: colors.info },
    { key: 'recorded', value: totals.recorded_only, icon: 'edit_note', ink: colors.textMuted, fill: colors.border },
  ];
  const whole = totals.recorded_sales;

  return (
    <View>
      {/* Decorative: the rows below carry the same numbers for screen readers. */}
      <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {whole > 0 ? (
          tiers
            .filter((tier) => tier.value > 0)
            .map((tier) => <View key={tier.key} style={[styles.segment, { flex: tier.value, backgroundColor: tier.fill }]} />)
        ) : (
          <View style={[styles.segment, { flex: 1, backgroundColor: colors.surfaceAlt }]} />
        )}
      </View>

      {tiers.map((tier) => (
        <View
          key={tier.key}
          style={styles.row}
          accessible
          accessibilityLabel={`${t(`tr.line.${tier.key}`)}: ${formatKwacha(tier.value)}, ${percent(tier.value, whole)}. ${t(`tr.line.${tier.key}.why`)}`}
        >
          <Icon name={tier.icon} size={iconSize.md} color={tier.ink} />
          <View style={styles.rowText}>
            <View style={styles.rowHead}>
              <Text style={[styles.label, { color: tier.ink }]}>{t(`tr.line.${tier.key}`)}</Text>
              <Text style={styles.amount}>{formatKwacha(tier.value)}</Text>
            </View>
            <View style={styles.rowHead}>
              <Text style={styles.why}>{t(`tr.line.${tier.key}.why`)}</Text>
              <Text style={styles.share}>{percent(tier.value, whole)}</Text>
            </View>
          </View>
        </View>
      ))}

      <View style={styles.total}>
        <Text style={styles.totalLabel}>{t('tr.total')}</Text>
        <Text style={styles.totalAmount}>{formatKwacha(whole)}</Text>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      height: 12,
      borderRadius: radii.pill,
      overflow: 'hidden',
      gap: 2,
      marginBottom: spacing.md,
    },
    segment: { minWidth: 4 },
    row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, alignItems: 'flex-start' },
    rowText: { flex: 1, gap: spacing.xxs },
    rowHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    label: { fontSize: typeScale.body, fontWeight: '700', flexShrink: 1 },
    amount: { fontSize: typeScale.body, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    why: { fontSize: typeScale.label, color: colors.textMuted, lineHeight: 18, flex: 1 },
    share: { fontSize: typeScale.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
    total: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
      marginTop: spacing.xs,
    },
    totalLabel: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
    totalAmount: { fontSize: typeScale.body, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  })
);
