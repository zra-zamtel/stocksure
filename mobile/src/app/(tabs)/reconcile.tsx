import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconBadge,
  LoadingList,
  Screen,
  SectionTitle,
  StatTile,
  TextLink,
} from '@/components/ui';
import { PermissionError, toNgwee, type Permission } from '@/core';
import { useReconciliation } from '@/db/hooks';
import { DEMO_TOOLS } from '@/lib/demo';
import { ignorePayment, injectDemoMessages, markSalePaid, saveCashCount, voidSale } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { markVisited } from '@/lib/getting-started';
import { colors, elevation, fonts, radii, spacing, themed, typeScale } from '@/theme/tokens';

const time = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/**
 * Does the money match the sales? Mobile money sales are paired with the
 * provider messages pasted in; what is left over is listed for the owner with
 * one tap to settle each item. Cash is checked by a count at closing.
 */
export default function ReconcileScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { can } = useAuth();
  const guard = usePermissionGuard();
  const { data, initialLoading, error, reload } = useReconciliation();
  // Opening this tab ticks "Check today's money" on the Home start list.
  useFocusEffect(useCallback(() => markVisited('reconcile'), []));
  const canResolve = can('reconcile.resolve');
  const canCountCash = can('cash.count');
  const seesMoney = can('money.insights');

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countedDraft, setCountedDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
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

  const footer = canResolve ? (
    <Button label={t('payMsg.open')} icon="sms" onPress={() => router.push('/payment-message')} />
  ) : undefined;

  if (!data) {
    return (
      <Screen title={t('reconcile.title')} footer={footer}>
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
          <EmptyState icon="fact_check" title={t('reconcile.empty.title')} message={t('reconcile.empty.message')} />
        )}
      </Screen>
    );
  }

  const cash = data.cash;
  const countedValue =
    countedDraft ?? (cash.countedCash !== undefined ? (cash.countedCash / 100).toFixed(2) : '');
  const noteValue = noteDraft ?? cash.note ?? '';
  const hasCounted = cash.countedCash !== undefined;
  const showCashForm = seesMoney || !hasCounted;
  const toCheck = data.salesWithoutPayment.length + data.needsReview.length;
  const allClear = toCheck === 0 && data.paymentsWithoutSale.length === 0;

  return (
    <Screen title={t('reconcile.title')} subtitle={t('reconcile.today')} footer={footer}>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {canResolve ? (
        <>
          <View style={styles.counts}>
            <StatTile
              value={data.matched.length}
              label={t('reconcile.count.matched')}
              icon="check_circle"
              tone={data.matched.length > 0 ? 'success' : 'neutral'}
            />
            <StatTile
              value={toCheck}
              label={t('reconcile.count.toCheck')}
              icon="schedule"
              tone={toCheck > 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              value={data.paymentsWithoutSale.length}
              label={t('reconcile.count.unknown')}
              icon="help"
              tone={data.paymentsWithoutSale.length > 0 ? 'warning' : 'neutral'}
            />
          </View>

          {allClear ? (
            <View style={styles.allClear}>
              <IconBadge name="check_circle" tone="success" size={36} />
              <Text style={styles.allClearText}>
                {data.matched.length > 0 ? t('reconcile.allClear') : t('reconcile.nothingYet')}
              </Text>
            </View>
          ) : null}

          {data.salesWithoutPayment.length > 0 ? (
            <Group title={t('reconcile.saleNoPayment')} hint={t('reconcile.saleNoPaymentHint')}>
              {data.salesWithoutPayment.map((sale, index) => (
                <Item
                  key={sale.saleId}
                  last={index === data.salesWithoutPayment.length - 1}
                  title={`${sale.provider ?? t('sale.new.mobileMoney')} · ${formatKwacha(sale.total)}`}
                  meta={[time(sale.createdAt), sale.reference].filter(Boolean).join(' · ')}
                  actions={
                    <>
                      <TextLink
                        accent
                        label={t('reconcile.markPaid')}
                        onPress={() => void perform(() => markSalePaid(db, sale.saleId))}
                      />
                      <TextLink
                        label={t('sales.void')}
                        onPress={() => void perform(() => voidSale(db, sale.saleId, 'No payment received'))}
                      />
                    </>
                  }
                />
              ))}
            </Group>
          ) : null}

          {data.needsReview.length > 0 ? (
            <Group title={t('reconcile.needsReview')} hint={t('reconcile.ambiguousBody')}>
              {data.needsReview.map((sale, index) => (
                <Item
                  key={sale.saleId}
                  last={index === data.needsReview.length - 1}
                  title={`${sale.provider ?? t('sale.new.mobileMoney')} · ${formatKwacha(sale.total)}`}
                  meta={time(sale.createdAt)}
                  actions={
                    <TextLink
                      accent
                      label={t('reconcile.markPaid')}
                      onPress={() => void perform(() => markSalePaid(db, sale.saleId))}
                    />
                  }
                />
              ))}
            </Group>
          ) : null}

          {data.paymentsWithoutSale.length > 0 ? (
            <Group title={t('reconcile.paymentNoSale')} hint={t('reconcile.paymentNoSaleHint')}>
              {data.paymentsWithoutSale.map((payment, index) => (
                <Item
                  key={payment.txnId}
                  last={index === data.paymentsWithoutSale.length - 1}
                  title={`${payment.provider} · ${formatKwacha(payment.amount)}`}
                  meta={[time(payment.receivedAt), payment.sender, payment.reference].filter(Boolean).join(' · ')}
                  actions={
                    <>
                      {can('sales.record') ? (
                        <TextLink accent label={t('reconcile.recordSale')} onPress={() => router.push('/sale/new')} />
                      ) : null}
                      <TextLink
                        label={t('reconcile.ignore')}
                        onPress={() => void perform(() => ignorePayment(db, payment.txnId))}
                      />
                    </>
                  }
                />
              ))}
            </Group>
          ) : null}

          {data.matched.length > 0 ? (
            <View>
              <TextLink
                accent
                label={showMatched ? t('reconcile.hideMatched') : t('reconcile.showMatched', { count: data.matched.length })}
                onPress={() => setShowMatched((value) => !value)}
              />
              {showMatched ? (
                <Group title={t('reconcile.matched')}>
                  {data.matched.map((match, index) => (
                    <Item
                      key={`${match.saleId}-${match.txnId}`}
                      last={index === data.matched.length - 1}
                      title={formatKwacha(match.amount)}
                      meta={[time(match.at), match.reference].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Group>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <Notice tone="info">{t('reconcile.staffNote')}</Notice>
      )}

      <Group title={t('reconcile.cash.title')}>
        <View style={styles.cash}>
          <View style={styles.cashRow}>
            <Text style={styles.cashLabel}>{t('reconcile.cash.openingFloat')}</Text>
            <Text style={styles.cashValue}>{formatKwacha(cash.openingFloat)}</Text>
          </View>
          {seesMoney ? (
            <View style={styles.cashRow}>
              <Text style={styles.cashLabel}>{t('reconcile.cash.expected')}</Text>
              <Text style={styles.cashValue}>{formatKwacha(cash.expected)}</Text>
            </View>
          ) : null}
          {showCashForm ? (
            <>
              <Field
                label={t('reconcile.cash.counted')}
                value={countedValue}
                onChangeText={setCountedDraft}
                placeholder="0.00"
                keyboardType="decimal-pad"
                prefix="K"
              />
              <Field
                label={t('reconcile.cash.note')}
                value={noteValue}
                onChangeText={setNoteDraft}
                placeholder={t('common.optional')}
              />
              <Button
                label={t('reconcile.cash.save')}
                icon="save"
                variant="secondary"
                disabled={!canCountCash || countedValue.trim() === ''}
                loading={busy}
                onPress={() => {
                  const amount = toNgwee(Number.parseFloat(countedValue.replace(',', '.')) || 0);
                  void perform(
                    async () => {
                      await saveCashCount(db, data.day, amount, noteValue.trim() || undefined, seesMoney);
                      setCountedDraft(null);
                      setNoteDraft(null);
                    },
                    t('reconcile.cashSaved'),
                    'cash.count'
                  );
                }}
              />
            </>
          ) : (
            <Text style={styles.muted}>{t('reconcile.cash.staffNote')}</Text>
          )}
          {seesMoney && cash.variance !== undefined ? (
            <View style={styles.cashRow}>
              <Text style={styles.cashLabel}>{t('reconcile.cash.variance')}</Text>
              <Text
                style={[
                  styles.cashValue,
                  styles.strong,
                  cash.variance < 0 ? styles.short : cash.variance > 0 ? styles.over : null,
                ]}
              >
                {cash.variance > 0 ? '+' : ''}
                {formatKwacha(cash.variance)}
              </Text>
            </View>
          ) : null}
        </View>
      </Group>

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

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionTitle>{title}</SectionTitle>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.groupCard}>{children}</View>
    </View>
  );
}

function Item({ title, meta, actions, last }: { title: string; meta?: string; actions?: ReactNode; last?: boolean }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle}>{title}</Text>
        {meta ? <Text style={styles.itemMeta}>{meta}</Text> : null}
      </View>
      {actions ? <View style={styles.itemActions}>{actions}</View> : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  counts: { flexDirection: 'row', gap: spacing.sm },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  allClearText: { flex: 1, fontSize: typeScale.body, color: colors.success, fontWeight: '700' },
  group: { gap: spacing.xs },
  hint: { fontSize: typeScale.label, color: colors.textMuted, lineHeight: 18 },
  groupCard: { gap: spacing.sm },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.card,
  },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontFamily: fonts.display, fontSize: typeScale.body, color: colors.text, fontVariant: ['tabular-nums'] },
  itemMeta: { fontSize: typeScale.label, color: colors.textMuted },
  itemActions: { flexDirection: 'row', alignItems: 'center' },
  cash: { padding: spacing.lg, gap: spacing.md },
  cashRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  cashLabel: { fontSize: typeScale.body, color: colors.textMuted, flexShrink: 1 },
  cashValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  strong: { fontFamily: fonts.display, fontSize: typeScale.heading },
  short: { color: colors.danger },
  over: { color: colors.success },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  demo: { alignItems: 'center' },
}));
