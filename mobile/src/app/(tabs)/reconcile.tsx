import { useFocusEffect, useRouter } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { MoneyKeypad } from '@/components/money-keypad';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  LoadingList,
  Screen,
  SectionTitle,
  TextLink,
} from '@/components/ui';
import { PermissionError, toNgwee, type Permission } from '@/core';
import { useReconciliation } from '@/db/hooks';
import { DEMO_TOOLS } from '@/lib/demo';
import { ignorePayment, injectDemoMessages, markSalePaid, saveCashCount, voidSale } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha, formatTime } from '@/lib/format';
import { markVisited } from '@/lib/getting-started';
import { colors, elevation, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

const time = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);

/**
 * Does the money match the sales? One status card says it (all good, or how
 * many to check), two bars compare mobile money sales with the money that came
 * in, each thing to check is a card with two big answers, and the cash count
 * is typed on a big keypad with the difference shown as it is typed.
 */
export default function ReconcileScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { can } = useAuth();
  const guard = usePermissionGuard();
  const { data, initialLoading, error, reload } = useReconciliation();
  // Opening this tab ticks "Check today's money" on the start list.
  useFocusEffect(useCallback(() => markVisited('reconcile'), []));
  const canResolve = can('reconcile.resolve');
  const canCountCash = can('cash.count');
  const seesMoney = can('money.insights');

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countedDraft, setCountedDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [cashHint, setCashHint] = useState<string | null>(null);
  const [showMatched, setShowMatched] = useState(false);

  async function perform(action: () => Promise<unknown>, success?: string, permission: Permission = 'reconcile.resolve') {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      guard(permission);
      await action();
      if (success) setMessage(success);
      reload();
    } catch (cause) {
      setActionError(
        cause instanceof PermissionError
          ? t('permission.denied')
          : cause instanceof Error
            ? cause.message
            : t('reconcile.error')
      );
    } finally {
      setBusy(false);
    }
  }

  /** Cancelling a sale is the one action that asks first: it cannot be taken back. */
  function confirmVoid(saleId: string, total: number) {
    Alert.alert(t('money.voidTitle'), t('money.voidBody', { amount: formatKwacha(total) }), [
      { text: t('money.keep'), style: 'cancel' },
      {
        text: t('money.voidConfirm'),
        style: 'destructive',
        onPress: () => void perform(() => voidSale(db, saleId, 'No payment received')),
      },
    ]);
  }

  const footer = canResolve ? (
    <Button label={t('payMsg.open')} icon="sms" onPress={() => router.push('/payment-message')} />
  ) : undefined;

  if (!data) {
    return (
      <Screen title={t('nav.money')} footer={footer}>
        {initialLoading ? (
          <LoadingList label={t('state.loading')} hero count={2} />
        ) : error ? (
          <ErrorState
            title={t('state.error.title')}
            message={t('state.error.message')}
            detail={error}
            retryLabel={t('common.retry')}
            onRetry={reload}
          />
        ) : (
          <EmptyState
            icon="fact_check"
            title={t('reconcile.empty.title')}
            message={t('reconcile.empty.message')}
            action={{ label: t('common.retry'), icon: 'refresh', onPress: reload }}
          />
        )}
      </Screen>
    );
  }

  const cash = data.cash;
  // A saved count shows as "125", not "125.00", so the keypad can keep typing
  // into it without first deleting two zeros.
  const countedValue = countedDraft ?? (cash.countedCash !== undefined ? String(cash.countedCash / 100) : '');
  const noteValue = noteDraft ?? cash.note ?? '';
  const hasCounted = cash.countedCash !== undefined;
  const showCashForm = seesMoney || !hasCounted;
  // The difference shows while typing, so the owner sees balanced, over or
  // short before saving, not only after.
  const typedCount = countedValue.trim() === '' ? null : Number.parseFloat(countedValue.replace(',', '.'));
  const draftVariance =
    typedCount !== null && Number.isFinite(typedCount) ? toNgwee(typedCount) - cash.expected : undefined;
  const shownVariance = countedDraft !== null ? draftVariance : cash.variance;
  const toCheck = data.salesWithoutPayment.length + data.needsReview.length + data.paymentsWithoutSale.length;
  const allClear = toCheck === 0;
  const mobileSales =
    sum(data.matched.map((match) => match.amount)) +
    sum(data.salesWithoutPayment.map((sale) => sale.total)) +
    sum(data.needsReview.map((sale) => sale.total));
  const moneyIn = sum(data.matched.map((match) => match.amount)) + sum(data.paymentsWithoutSale.map((payment) => payment.amount));
  const barMax = Math.max(mobileSales, moneyIn, 1);

  return (
    <Screen title={t('nav.money')} subtitle={t('reconcile.today')} footer={footer}>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {canResolve ? (
        <>
          {/* Not one accessible block: TalkBack reads the title, then each bar. */}
          <View style={[styles.status, allClear ? styles.statusGood : styles.statusCheck]}>
            <View style={styles.statusHead}>
              <Icon
                name={allClear ? 'check_circle' : 'warning'}
                size={iconSize.xl}
                color={allClear ? colors.success : colors.warning}
              />
              <Text
                style={[styles.statusTitle, allClear ? styles.good : styles.check]}
                accessibilityLiveRegion="polite"
              >
                {allClear
                  ? data.matched.length === 0
                    ? t('money.nothingYet')
                    : t('money.allGood')
                  : t('money.toCheck', { count: toCheck })}
              </Text>
            </View>
            {mobileSales > 0 || moneyIn > 0 ? (
              <View style={styles.bars}>
                <Bar icon="receipt_long" label={t('money.sales')} amount={mobileSales} max={barMax} />
                <Bar icon="payments" label={t('money.moneyIn')} amount={moneyIn} max={barMax} />
              </View>
            ) : null}
          </View>

          {data.salesWithoutPayment.map((sale) => (
            <CheckCard
              key={sale.saleId}
              icon="receipt_long"
              kind={t('money.sellNoMoney')}
              amount={sale.total}
              meta={[sale.provider ?? t('sale.new.mobileMoney'), time(sale.createdAt)].join(' · ')}
              yes={{ label: t('money.came'), icon: 'check', onPress: () => void perform(() => markSalePaid(db, sale.saleId)) }}
              no={{ label: t('money.none'), icon: 'close', onPress: () => confirmVoid(sale.saleId, sale.total) }}
              busy={busy}
            />
          ))}

          {data.needsReview.map((sale) => (
            <CheckCard
              key={sale.saleId}
              icon="help"
              kind={t('money.twoMatch')}
              amount={sale.total}
              meta={[sale.provider ?? t('sale.new.mobileMoney'), time(sale.createdAt)].join(' · ')}
              hint={t('reconcile.ambiguousBody')}
              yes={{ label: t('money.came'), icon: 'check', onPress: () => void perform(() => markSalePaid(db, sale.saleId)) }}
              busy={busy}
            />
          ))}

          {data.paymentsWithoutSale.map((payment) => (
            <CheckCard
              key={payment.txnId}
              icon="sms"
              kind={t('money.moneyNoSale')}
              amount={payment.amount}
              meta={[payment.provider, time(payment.receivedAt), payment.sender].filter(Boolean).join(' · ')}
              yes={
                can('sales.record')
                  ? { label: t('money.makeSale'), icon: 'point_of_sale', onPress: () => router.push('/sale/new') }
                  : undefined
              }
              no={{ label: t('money.notSale'), icon: 'block', onPress: () => void perform(() => ignorePayment(db, payment.txnId)) }}
              busy={busy}
            />
          ))}

          {data.matched.length > 0 ? (
            <View style={styles.matched}>
              <TextLink
                accent
                label={showMatched ? t('reconcile.hideMatched') : t('reconcile.showMatched', { count: data.matched.length })}
                onPress={() => setShowMatched((value) => !value)}
              />
              {showMatched
                ? data.matched.map((match) => (
                    <View key={`${match.saleId}-${match.txnId}`} style={styles.matchRow}>
                      <Icon name="check_circle" size={iconSize.md} color={colors.success} />
                      <Text style={styles.matchAmount}>{formatKwacha(match.amount)}</Text>
                      <Text style={styles.matchMeta}>{time(match.at)}</Text>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </>
      ) : (
        <Notice tone="info">{t('reconcile.staffNote')}</Notice>
      )}

      <SectionTitle>{t('money.cash.title')}</SectionTitle>
      <View style={styles.cashCard}>
        <View style={styles.cashRow}>
          <Icon name="savings" size={iconSize.lg} color={colors.textMuted} />
          <Text style={styles.cashLabel}>{t('money.cash.start')}</Text>
          <Text style={styles.cashValue}>{formatKwacha(cash.openingFloat)}</Text>
        </View>
        {seesMoney ? (
          <View style={styles.cashRow}>
            <Icon name="calculate" size={iconSize.lg} color={colors.textMuted} />
            <Text style={styles.cashLabel}>{t('money.cash.expected')}</Text>
            <Text style={styles.cashValue}>{formatKwacha(cash.expected)}</Text>
          </View>
        ) : null}

        {showCashForm ? (
          <>
            <MoneyKeypad
              value={countedValue}
              onChange={(next) => {
                setCashHint(null);
                setCountedDraft(next);
              }}
              label={t('money.cash.counted')}
              disabled={!canCountCash || busy}
            />
            {/* Owners see the difference as they type; staff count blind. */}
            {seesMoney && shownVariance !== undefined ? (
              <Difference variance={shownVariance} />
            ) : null}
            <Field
              label={t('reconcile.cash.note')}
              value={noteValue}
              onChangeText={setNoteDraft}
              placeholder={t('common.optional')}
            />
            <Button
              label={t('money.cash.save')}
              icon="save"
              disabled={!canCountCash}
              loading={busy}
              onPress={() => {
                // Checked on press: a greyed-out button would not say what is missing.
                if (countedValue.trim() === '' || draftVariance === undefined) {
                  setCashHint(t('reconcile.cash.enterAmount'));
                  return;
                }
                setCashHint(null);
                const amount = toNgwee(Number.parseFloat(countedValue.replace(',', '.')) || 0);
                void perform(
                  async () => {
                    await saveCashCount(db, data.day, amount, noteValue.trim() || undefined, seesMoney);
                    setCountedDraft(null);
                    setNoteDraft(null);
                  },
                  // "Saved at 17:40" appears under the keypad instead of a notice at the top.
                  undefined,
                  'cash.count'
                );
              }}
            />
          </>
        ) : (
          <Text style={styles.muted}>{t('reconcile.cash.staffNote')}</Text>
        )}
        {cashHint ? (
          <View style={styles.cashRow}>
            <Icon name="error" size={iconSize.md} color={colors.danger} />
            <Text style={styles.cashHint}>{cashHint}</Text>
          </View>
        ) : null}
        {countedDraft === null && cash.countedAt ? (
          <View style={styles.cashRow}>
            <Icon name="check_circle" size={iconSize.md} color={colors.success} />
            <Text style={styles.saved}>{t('reconcile.cash.savedAt', { time: formatTime(cash.countedAt) })}</Text>
          </View>
        ) : null}
      </View>

      {canResolve && DEMO_TOOLS ? (
        <View style={styles.demo}>
          <TextLink
            label={t('reconcile.demo')}
            onPress={() => void perform(() => injectDemoMessages(db, data.day), t('reconcile.demoAdded'))}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/** One bar of the sales-versus-money comparison, with its picture and amount. */
function Bar({ icon, label, amount, max }: { icon: AndroidSymbol; label: string; amount: number; max: number }) {
  return (
    <View style={styles.bar} accessible accessibilityLabel={`${label}: ${formatKwacha(amount)}`}>
      <View style={styles.barHead}>
        <Icon name={icon} size={iconSize.md} color={colors.textMuted} />
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barAmount}>{formatKwacha(amount)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round((amount / max) * 100)}%` }]} />
      </View>
    </View>
  );
}

type Answer = { label: string; icon: AndroidSymbol; onPress: () => void };

/** One thing to check: what it is, the amount, and the two answers as big buttons. */
function CheckCard({
  icon,
  kind,
  amount,
  meta,
  hint,
  yes,
  no,
  busy,
}: {
  icon: AndroidSymbol;
  kind: string;
  amount: number;
  meta: string;
  hint?: string;
  yes?: Answer;
  no?: Answer;
  busy: boolean;
}) {
  return (
    <View style={styles.checkCard}>
      <View style={styles.checkHead}>
        <View style={styles.checkIcon}>
          <Icon name={icon} size={iconSize.lg} color={colors.warning} />
        </View>
        <View style={styles.checkText}>
          <Text style={styles.checkKind}>{kind}</Text>
          <Text style={styles.checkAmount}>{formatKwacha(amount)}</Text>
          <Text style={styles.checkMeta}>{meta}</Text>
        </View>
      </View>
      {hint ? <Text style={styles.checkHint}>{hint}</Text> : null}
      <View style={styles.answers}>
        {yes ? (
          <View style={styles.answer}>
            <Button label={yes.label} icon={yes.icon} disabled={busy} onPress={yes.onPress} />
          </View>
        ) : null}
        {no ? (
          <View style={styles.answer}>
            <Button label={no.label} icon={no.icon} variant="secondary" disabled={busy} onPress={no.onPress} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Balanced, over or short, as an icon and colour and words (never colour alone). */
function Difference({ variance }: { variance: number }) {
  const { t } = useI18n();
  const look =
    variance === 0
      ? { icon: 'check_circle' as const, color: colors.success, text: t('money.cash.balanced') }
      : variance > 0
        ? { icon: 'trending_up' as const, color: colors.success, text: t('money.cash.over', { amount: formatKwacha(variance) }) }
        : { icon: 'trending_down' as const, color: colors.danger, text: t('money.cash.short', { amount: formatKwacha(-variance) }) };
  return (
    <View style={styles.difference} accessible accessibilityLiveRegion="polite" accessibilityLabel={look.text}>
      <Icon name={look.icon} size={iconSize.xl} color={look.color} />
      <Text style={[styles.differenceText, { color: look.color }]}>{look.text}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  status: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    ...elevation.card,
  },
  statusGood: { backgroundColor: colors.successSoft, borderColor: colors.success },
  statusCheck: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusTitle: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.title },
  good: { color: colors.success },
  check: { color: colors.text },
  bars: { gap: spacing.sm },
  bar: { gap: spacing.xs },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  barLabel: { flex: 1, fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  barAmount: { fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text, fontVariant: ['tabular-nums'] },
  barTrack: { height: spacing.md, borderRadius: radii.pill, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  checkCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.card,
  },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkIcon: {
    width: touch.big,
    height: touch.big,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningSoft,
  },
  checkText: { flex: 1, gap: spacing.xxs },
  checkKind: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '700' },
  checkAmount: { fontFamily: fonts.display, fontSize: typeScale.display, color: colors.text, fontVariant: ['tabular-nums'] },
  checkMeta: { fontSize: typeScale.label, color: colors.textMuted },
  checkHint: { fontSize: typeScale.label, color: colors.textMuted },
  answers: { flexDirection: 'row', gap: spacing.sm },
  answer: { flex: 1 },
  matched: { gap: spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touch.minHeight },
  matchAmount: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text, fontVariant: ['tabular-nums'] },
  matchMeta: { fontSize: typeScale.label, color: colors.textMuted },
  cashCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.card,
  },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cashLabel: { flex: 1, fontSize: typeScale.body, color: colors.textMuted },
  cashValue: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  difference: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  differenceText: { fontFamily: fonts.display, fontSize: typeScale.title },
  cashHint: { flex: 1, fontSize: typeScale.body, color: colors.danger },
  saved: { flex: 1, fontSize: typeScale.body, color: colors.success, fontWeight: '600' },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  demo: { alignItems: 'center' },
}));
