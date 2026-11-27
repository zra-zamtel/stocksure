import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SmartInvoicePanel } from '@/components/smart-invoice-panel';
import { Notice } from '@/components/auth';
import { Button, Card, HelpTip, Icon, IconBadge, LoadingList, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { estimateTurnoverTax, potStatus } from '@/core';
import { useTaxSnapshot } from '@/db/hooks';
import { taxRules } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import { markVisited } from '@/lib/getting-started';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, typeScale } from '@/theme/tokens';

export default function TaxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: snapshot, initialLoading } = useTaxSnapshot();
  // Opening this tab ticks "See your tax estimate" on the Home start list.
  useFocusEffect(useCallback(() => markVisited('tax'), []));
  const estimate = estimateTurnoverTax(snapshot.turnover, taxRules, snapshot.yearToDate);
  const pot = potStatus(estimate.estimatedTax, snapshot.potBalance);
  const period = snapshot.period;
  // The pill names the state; the amount sits under the balance, so the two
  // never repeat "Short by" side by side.
  const potLabel =
    pot.state === 'short'
      ? t('tax.pot.state.short')
      : pot.state === 'over'
        ? t('tax.pot.state.over')
        : t('tax.pot.covered');
  const potTone = pot.state === 'short' ? 'warning' : pot.state === 'over' ? 'info' : 'success';

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
    >
      {estimate.turnover === 0 ? <HelpTip icon="info">{t('tax.empty.tip')}</HelpTip> : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>{t('tax.estimate')}</Text>
          <Icon name="account_balance" size={iconSize.md} color={colors.onInkMuted} />
        </View>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
          {formatKwacha(estimate.estimatedTax)}
        </Text>
        <View style={styles.heroFoot}>
          <View style={styles.heroStat}>
            <Icon name="calendar_month" size={iconSize.sm} color={colors.onInkMuted} />
            <Text style={styles.heroMeta}>
              {t('tax.due')}: {period?.dueOn ? formatDay(period.dueOn) : t('common.notYet')}
            </Text>
          </View>
        </View>
      </View>

      <Card>
        <Row label={t('tax.turnover')} value={formatKwacha(estimate.turnover)} />
        <Row label={t('tax.rate')} value={`${(estimate.rate * 100).toFixed(1)}%`} />
        {estimate.incomeTax ? (
          <Text style={styles.disclaimer}>
            {t('tax.incomeTax', { amount: formatKwacha(estimate.threshold) })}
          </Text>
        ) : null}
        <Text style={styles.disclaimer}>{t('tax.warning')}</Text>
      </Card>

      {snapshot.unresolvedSales > 0 ? (
        <Notice tone="warning">
          {t('tax.unreconciled')} ({snapshot.unresolvedSales})
        </Notice>
      ) : null}

      <SectionTitle>{t('tax.pot.title')}</SectionTitle>
      <Card>
        <View style={styles.potTop}>
          <IconBadge name="savings" tone={potTone} size={44} />
          <View style={styles.potText}>
            <Text style={styles.potLabel}>{t('tax.pot.balance')}</Text>
            <Text style={styles.potValue}>{formatKwacha(snapshot.potBalance)}</Text>
            {pot.state === 'covered' ? null : (
              <Text style={styles.potLabel}>
                {pot.state === 'short' ? t('tax.pot.short') : t('tax.pot.over')}{' '}
                {formatKwacha(Math.abs(pot.difference))}
              </Text>
            )}
          </View>
          <Pill label={potLabel} tone={potTone} />
        </View>
        <View style={styles.potActions}>
          <Button label={t('tax.pot.topUp')} icon="add" onPress={() => router.push('/tax/pot')} />
          <Button
            label={t('tax.pot.payZra')}
            icon="account_balance"
            variant="secondary"
            onPress={() => router.push('/tax/pot')}
          />
        </View>
        <Text style={styles.disclaimer}>{t('tax.pot.noMoneyMoves')}</Text>
      </Card>

      <SectionTitle>{t('si.title')}</SectionTitle>
      <SmartInvoicePanel compact />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  disclaimer: { fontSize: typeScale.caption, lineHeight: 17, color: colors.textMuted, marginTop: spacing.xs },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.xs,
    ...elevation.raised,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: {
    fontSize: typeScale.label,
    color: colors.onInkMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroValue: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -0.8,
    color: colors.onInk,
    fontVariant: ['tabular-nums'],
  },
  heroFoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroMeta: { fontSize: typeScale.label, color: colors.onInkMuted, fontWeight: '600' },
  potTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  potText: { flex: 1, gap: 2 },
  potLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  potValue: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text, fontVariant: ['tabular-nums'] },
  potActions: { gap: spacing.sm, marginTop: spacing.sm },
}));
