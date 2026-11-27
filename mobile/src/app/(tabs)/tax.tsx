import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Notice } from '@/components/auth';
import { SmartInvoicePanel } from '@/components/smart-invoice-panel';
import { TaxJar } from '@/components/tax-jar';
import { Button, Card, HelpTip, Icon, LoadingList, Row, Screen } from '@/components/ui';
import { estimateTurnoverTax, potStatus } from '@/core';
import { useTaxSnapshot } from '@/db/hooks';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import { markVisited } from '@/lib/getting-started';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

/**
 * Tax in one sentence: how much you may owe and by when, a jar that shows how
 * much is already set aside, and one button to put more aside. How the
 * estimate was worked out (turnover, rate, Smart Invoice) waits behind
 * "How we got this". The numbers are the same estimate as before.
 */
export default function TaxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: snapshot, initialLoading } = useTaxSnapshot();
  const [howOpen, setHowOpen] = useState(false);
  // Opening this tab ticks "See your tax estimate" on the start list.
  useFocusEffect(useCallback(() => markVisited('tax'), []));
  const estimate = estimateTurnoverTax(snapshot.turnover, taxRules, snapshot.yearToDate);
  const pot = potStatus(estimate.estimatedTax, snapshot.potBalance);
  const period = snapshot.period;

  if (initialLoading) {
    return (
      <Screen title={t('tax.title')}>
        <LoadingList label={t('state.loading')} hero count={1} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('tax.title')}
      subtitle={period ? `${formatDay(period.startsOn)} – ${formatDay(period.endsOn)}` : undefined}
      footer={<Button label={t('tax.putAside')} icon="savings" onPress={() => router.push('/tax/pot')} />}
    >
      {estimate.turnover === 0 ? <HelpTip icon="info">{t('tax.empty.tip')}</HelpTip> : null}

      <View
        style={styles.hero}
        accessible
        accessibilityLabel={`${t('tax.owe')} ${formatKwacha(estimate.estimatedTax)}, ${
          period?.dueOn ? t('tax.by', { date: formatDay(period.dueOn) }) : t('tax.noDate')
        }. ${t('tax.estimateNote')}`}
      >
        <View style={styles.heroTop}>
          <Icon name="account_balance" size={iconSize.lg} color={colors.onInkMuted} />
          <Text style={styles.heroLabel}>{t('tax.owe')}</Text>
        </View>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
          {formatKwacha(estimate.estimatedTax)}
        </Text>
        <View style={styles.heroStat}>
          <Icon name="calendar_month" size={iconSize.md} color={colors.onInkMuted} />
          <Text style={styles.heroMeta}>
            {period?.dueOn ? t('tax.by', { date: formatDay(period.dueOn) }) : t('tax.noDate')}
          </Text>
        </View>
        <Text style={styles.heroNote}>{t('tax.estimateNote')}</Text>
      </View>

      <Card>
        <TaxJar saved={snapshot.potBalance} owed={estimate.estimatedTax} state={pot.state} />
      </Card>

      {snapshot.unresolvedSales > 0 ? (
        <Notice tone="warning">
          {t('tax.unreconciled')} ({snapshot.unresolvedSales})
        </Notice>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tax.how')}
        accessibilityState={{ expanded: howOpen }}
        onPress={() => setHowOpen((open) => !open)}
        android_ripple={{ color: colors.ripple }}
        style={styles.howToggle}
      >
        <Icon name="help" size={iconSize.lg} color={colors.primaryInk} />
        <Text style={styles.howText}>{t('tax.how')}</Text>
        <Icon name={howOpen ? 'expand_less' : 'expand_more'} size={iconSize.lg} color={colors.primaryInk} />
      </Pressable>

      {howOpen ? (
        <>
          <Card>
            <Row label={t('tax.turnover')} value={formatKwacha(estimate.turnover)} />
            <Row label={t('tax.rate')} value={`${(estimate.rate * 100).toFixed(1)}%`} />
            {estimate.incomeTax ? (
              <Text style={styles.caption}>{t('tax.incomeTax', { amount: formatKwacha(estimate.threshold) })}</Text>
            ) : null}
            <Text style={styles.caption}>{t('tax.warning')}</Text>
          </Card>
          <SmartInvoicePanel compact />
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkLine,
    ...elevation.raised,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLabel: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.onInkMuted },
  heroValue: {
    fontFamily: fonts.display,
    fontSize: typeScale.money,
    lineHeight: typeScale.money + 8,
    letterSpacing: -1,
    color: colors.onInk,
    fontVariant: ['tabular-nums'],
  },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroMeta: { fontSize: typeScale.body, color: colors.onInk, fontWeight: '600' },
  heroNote: { fontSize: typeScale.caption, color: colors.onInkMuted },
  howToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.big,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  howText: { flex: 1, fontSize: typeScale.body, fontWeight: '700', color: colors.primaryInk },
  caption: { fontSize: typeScale.caption, color: colors.textMuted, marginTop: spacing.xs },
}));
