import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAuth } from '@/auth/session';
import { isValidPhone, newId, normalisePhone, type Provider } from '@/core';
import { useI18n } from '@/i18n';
import { ApiError, feeQuoteOnServer, type PaymentRequest, paymentRequestStatusOnServer, requestToPayOnServer } from '@/lib/api';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, themed, typeScale } from '@/theme/tokens';
import { ConnectDevice } from './connect-device';
import { DetectedNetwork, NetworkOption, WALLET_NAMES } from './network-mark';
import { Button, Field, FormError, Icon, TextLink } from './ui';

const POLL_MS = 2000;
/** How long the "Paid" tick stays up before the sale is saved and the dialog closes. */
const PAID_PAUSE_MS = 1100;
const PROVIDERS: Provider[] = ['MTN', 'Airtel', 'Zamtel'];

/** Network prefixes after the leading 0, e.g. 096 is MTN. */
const PREFIXES: Record<Provider, string[]> = {
  MTN: ['96', '76'],
  Airtel: ['97', '77', '57'],
  Zamtel: ['95', '75'],
};

/** Which network a number is on, read from its prefix; null while it is too short to tell. */
export function providerForPhone(input: string): Provider | null {
  const local = normalisePhone(input);
  if (local.length < 3) return null;
  const prefix = local.slice(1, 3);
  return (Object.keys(PREFIXES) as Provider[]).find((provider) => PREFIXES[provider].includes(prefix)) ?? null;
}

export type PaidRequest = {
  reference: string;
  phone: string;
  /** The sale's amount: what the shop keeps and what reconciliation matches. */
  amount: number;
  /** The mobile money fee the customer paid on top, if any. */
  fee?: number;
  provider: Provider;
  at: string;
};

type Phase = 'form' | 'sending' | 'waiting' | 'paid' | 'failed' | 'manual';

/**
 * The mobile money step of a sale, as one dialog: type the customer's number,
 * send the request, wait while they enter their PIN on their own phone, and
 * the sale saves itself once they approve. If the customer has already paid,
 * or there is no internet, the cashier can type the reference from the
 * payment message instead.
 */
export function RequestToPayDialog({
  amount,
  initialProvider,
  onClose,
  onPaid,
  onManual,
}: {
  /** Ngwee to collect: the whole sale, or the mobile money part of a split. */
  amount: number;
  initialProvider: Provider;
  onClose: () => void;
  /** The customer approved. The parent saves the sale. */
  onPaid: (paid: PaidRequest) => void;
  /** Paid without a request: the parent saves the sale with this provider and reference. */
  onManual: (input: { provider: Provider; reference: string }) => void;
}) {
  const { t } = useI18n();
  const { deviceToken, user } = useAuth();
  const [phase, setPhase] = useState<Phase>('form');
  const [needsConnect, setNeedsConnect] = useState(false);
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [reference, setReference] = useState('');
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The fee passed on to the customer, from the server so it always matches
  // what the request will charge. Null until known (or with no internet).
  const [quote, setQuote] = useState<{ fee: number; charged: number; feePercent: string } | null>(null);
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    if (!deviceToken) return;
    let cancelled = false;
    feeQuoteOnServer({ amount, deviceToken })
      .then((next) => {
        if (!cancelled) setQuote(next);
      })
      .catch(() => {
        // Without a quote the sheet shows the sale amount; the request's own
        // answer fills the fee in once it is sent.
      });
    return () => {
      cancelled = true;
    };
  }, [amount, deviceToken]);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  // Ask the server every two seconds until the customer answers.
  useEffect(() => {
    if (phase !== 'waiting' || !request || !deviceToken) return;
    let stopped = false;
    let paidTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      paymentRequestStatusOnServer({ id: request.id, deviceToken })
        .then((next) => {
          if (stopped || next.status === 'pending') return;
          stopped = true;
          clearInterval(timer);
          if (next.status === 'successful') {
            setPhase('paid');
            // Let the tick register before the dialog closes on the saved sale.
            paidTimer = setTimeout(
              () =>
                onPaidRef.current({
                  reference: next.reference,
                  phone: next.phone,
                  amount: next.amount,
                  fee: next.fee,
                  provider: next.provider,
                  at: next.completedAt ?? new Date().toISOString(),
                }),
              PAID_PAUSE_MS,
            );
          } else {
            setFailure(next.status === 'expired' ? t('rtp.expired') : next.reason || t('rtp.failed'));
            setPhase('failed');
          }
        })
        .catch(() => {
          // A missed poll is retried on the next tick; the server keeps the answer.
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (paidTimer) clearTimeout(paidTimer);
    };
  }, [deviceToken, phase, request, t]);

  function changePhone(value: string) {
    setPhone(value);
    setError(null);
    const detected = providerForPhone(value);
    if (detected) setProvider(detected);
  }

  /** No key, or the server refused it: owners reconnect here, staff are told who can. */
  function askToConnect() {
    if (user?.role === 'owner') {
      setNeedsConnect(true);
      setError(null);
    } else {
      setError(t('connect.askOwner'));
    }
  }

  async function send(tokenOverride?: string) {
    setError(null);
    const token = tokenOverride ?? (needsConnect ? null : deviceToken);
    if (!isValidPhone(phone)) return setError(t('rtp.error.phone'));
    if (!token) return askToConnect();
    setPhase('sending');
    try {
      const created = await requestToPayOnServer({
        id: newId('rtp'),
        provider,
        phone: normalisePhone(phone),
        amount,
        deviceToken: token,
      });
      setRequest(created);
      if (created.fee !== undefined && created.charged !== undefined) {
        setQuote((current) => ({
          fee: created.fee ?? 0,
          charged: created.charged ?? amount,
          feePercent: current?.feePercent ?? '',
        }));
      }
      setPhase('waiting');
    } catch (cause) {
      setPhase('form');
      if (cause instanceof ApiError && cause.code === 'unauthorized') return askToConnect();
      setError(
        cause instanceof ApiError && cause.code === 'offline'
          ? t('rtp.error.offline')
          : cause instanceof Error
            ? cause.message
            : t('rtp.error.server'),
      );
    }
  }

  const hasFee = Boolean(quote && quote.fee > 0);
  // What the customer's phone will ask for: the sale plus any fee passed on.
  const charged = hasFee && quote ? quote.charged : amount;
  // Read from the prefix as the number is typed; the chosen tile can override it.
  const detected = providerForPhone(phone);
  const blocking = phase === 'sending' || phase === 'paid';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={blocking ? () => undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>{t('rtp.title')}</Text>
          <Text style={styles.amount}>{formatKwacha(charged)}</Text>
          {hasFee && quote ? (
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{t('rtp.sale')}</Text>
                <Text style={styles.breakdownValue}>{formatKwacha(amount)}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>
                  {quote.feePercent ? t('rtp.fee', { percent: quote.feePercent }) : t('rtp.feePlain')}
                </Text>
                <Text style={styles.breakdownValue}>{formatKwacha(quote.fee)}</Text>
              </View>
              <View style={[styles.breakdownRow, styles.breakdownTotal]}>
                <Text style={styles.breakdownTotalLabel}>{t('rtp.customerPays')}</Text>
                <Text style={styles.breakdownTotalValue}>{formatKwacha(charged)}</Text>
              </View>
              <Text style={styles.breakdownNote}>{t('rtp.feeNote')}</Text>
            </View>
          ) : null}

          {phase === 'form' || phase === 'sending' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.body}>
              <Field
                label={t('rtp.phone')}
                value={phone}
                onChangeText={changePhone}
                placeholder="97 123 4567"
                keyboardType="phone-pad"
                prefix="+260"
                hint={detected ? t('rtp.detected', { wallet: WALLET_NAMES[detected] }) : t('rtp.phoneHint')}
                trailing={<DetectedNetwork provider={detected} />}
                autoFocus
              />
              <View style={styles.networkGroup}>
                <Text style={styles.networkLabel}>{t('rtp.network')}</Text>
                <View style={styles.providers} accessibilityRole="radiogroup" accessibilityLabel={t('rtp.network')}>
                  {PROVIDERS.map((option) => (
                    <NetworkOption
                      key={option}
                      provider={option}
                      selected={provider === option}
                      onPress={() => setProvider(option)}
                    />
                  ))}
                </View>
              </View>
              {error ? <FormError message={error} /> : null}
              {needsConnect ? (
                <ConnectDevice
                  bare
                  onConnected={(token) => {
                    setNeedsConnect(false);
                    void send(token);
                  }}
                />
              ) : null}
              <Button
                label={t('rtp.send')}
                loading={phase === 'sending'}
                disabled={phone.trim() === ''}
                onPress={() => void send()}
              />
              <View style={styles.links}>
                <TextLink label={t('rtp.alreadyPaid')} accent onPress={() => setPhase('manual')} />
                <TextLink label={t('common.cancel')} onPress={onClose} />
              </View>
            </Animated.View>
          ) : null}

          {phase === 'waiting' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.status}>
              <Pulse />
              <Text style={styles.statusTitle} accessibilityLiveRegion="polite">
                {t('rtp.waitingTitle')}
              </Text>
              <Text style={styles.statusBody}>
                {t('rtp.waitingBody', { phone: request?.phone ?? normalisePhone(phone) })}
              </Text>
              <View style={styles.actions}>
                <Button label={t('rtp.cancelRequest')} variant="secondary" onPress={() => setPhase('form')} />
              </View>
            </Animated.View>
          ) : null}

          {phase === 'paid' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.status}>
              <View style={[styles.badge, styles.badgePaid]}>
                <Icon name="check" size={32} color={colors.primaryText} />
              </View>
              <Text style={styles.statusTitle} accessibilityLiveRegion="assertive">
                {t('rtp.paidTitle')}
              </Text>
              <Text style={styles.statusBody}>{t('rtp.saving')}</Text>
            </Animated.View>
          ) : null}

          {phase === 'failed' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.status}>
              <View style={[styles.badge, styles.badgeFailed]}>
                <Text style={[styles.badgeMark, styles.badgeMarkFailed]}>!</Text>
              </View>
              <Text style={styles.statusTitle} accessibilityLiveRegion="assertive">
                {t('rtp.failedTitle')}
              </Text>
              <Text style={styles.statusBody}>{failure}</Text>
              <View style={styles.actions}>
                <Button label={t('rtp.sendAgain')} onPress={() => setPhase('form')} />
                <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
              </View>
            </Animated.View>
          ) : null}

          {phase === 'manual' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.body}>
              <Text style={styles.statusBody}>{t('rtp.manualBody')}</Text>
              <View style={styles.networkGroup}>
                <Text style={styles.networkLabel}>{t('rtp.network')}</Text>
                <View style={styles.providers} accessibilityRole="radiogroup" accessibilityLabel={t('rtp.network')}>
                  {PROVIDERS.map((option) => (
                    <NetworkOption
                      key={option}
                      provider={option}
                      selected={provider === option}
                      onPress={() => setProvider(option)}
                    />
                  ))}
                </View>
              </View>
              <Field
                label={t('sale.new.reference')}
                value={reference}
                onChangeText={setReference}
                placeholder={t('common.optional')}
                hint={t('sale.new.referenceHint')}
              />
              <Button
                label={t('rtp.recordSale')}
                onPress={() => onManual({ provider, reference: reference.trim() })}
              />
              <View style={styles.links}>
                <TextLink label={t('rtp.backToRequest')} accent onPress={() => setPhase('form')} />
              </View>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** A soft blue ring that breathes while the customer decides. */
function Pulse() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1.15, { duration: 700 }), -1, true);
  }, [pulse, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[styles.badge, styles.badgeWaiting, style]}>
      <ActivityIndicator color={colors.primary} />
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30, 30, 28, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg * 1.5,
    borderTopRightRadius: radii.lg * 1.5,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  eyebrow: {
    fontSize: typeScale.label,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primaryInk,
  },
  amount: { fontSize: typeScale.display + 6, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  body: { gap: spacing.md, marginTop: spacing.md },
  providers: { flexDirection: 'row', gap: spacing.sm },
  breakdown: {
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  breakdownLabel: { flexShrink: 1, fontSize: typeScale.label, color: colors.textMuted },
  breakdownValue: { fontSize: typeScale.label, color: colors.text, fontVariant: ['tabular-nums'] },
  breakdownTotal: { marginTop: spacing.xs },
  breakdownTotalLabel: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  breakdownTotalValue: { fontSize: typeScale.body, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  breakdownNote: { fontSize: typeScale.caption, lineHeight: 17, color: colors.textMuted, marginTop: spacing.xs },
  networkGroup: { gap: spacing.xs },
  networkLabel: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  links: { alignItems: 'center' },
  status: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  badgeWaiting: { backgroundColor: colors.primarySoft },
  badgePaid: { backgroundColor: colors.success },
  badgeFailed: { backgroundColor: colors.dangerSoft },
  badgeMark: { fontSize: 36, fontWeight: '800', color: colors.primaryText },
  badgeMarkFailed: { color: colors.danger },
  statusTitle: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, textAlign: 'center' },
  statusBody: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
}));
