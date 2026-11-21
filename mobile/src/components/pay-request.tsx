import { useSQLiteContext } from 'expo-sqlite';
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
import type { Provider } from '@/core';
import { recordGatewayPayment } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import {
  GatewayAbortError,
  normaliseMobile,
  paymentGateway,
  providerForMobile,
  type CollectionStatus,
} from '@/lib/payment-gateway';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';
import { Button, Choice, Field, FormError, Icon } from './ui';

const PROVIDERS: Provider[] = ['MTN', 'Airtel', 'Zamtel'];

export type PaidRequest = { provider: Provider; reference: string; phone: string; amount: number };

type Phase = 'form' | CollectionStatus;

/**
 * Asks the customer to pay from their own mobile money wallet: the owner types
 * the customer's number, the customer approves on their phone, and the payment
 * is recorded with its reference so the daily check matches it by itself.
 * The gateway is simulated for now (see lib/payment-gateway), and the sheet
 * says so. Mount it only while open, so every request starts from a clean form.
 */
export function PayRequestSheet({
  visible,
  amount,
  initialProvider,
  onClose,
  onPaid,
}: {
  visible: boolean;
  /** Ngwee to collect. */
  amount: number;
  initialProvider: Provider;
  onClose: () => void;
  /** Called once the customer approved and the payment is saved. */
  onPaid: (paid: PaidRequest) => void;
}) {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const [phase, setPhase] = useState<Phase>('form');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paid, setPaid] = useState<PaidRequest | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const busy = phase === 'sending' || phase === 'waiting';
  const failed = phase === 'declined' || phase === 'insufficient' || phase === 'timeout';

  function changePhone(value: string) {
    setPhone(value);
    setPhoneError(null);
    // Pick the network from the number, so the owner rarely has to.
    const detected = providerForMobile(value);
    if (detected) setProvider(detected);
  }

  async function send() {
    const local = normaliseMobile(phone);
    if (!local) {
      setPhoneError(t('pay.error.phone'));
      return;
    }
    setSaveError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await paymentGateway.collect(
        { amount, provider, phone: local },
        { onStatus: setPhase, signal: controller.signal },
      );
      if (result.status !== 'approved' || !result.reference) return;
      const done = { provider, reference: result.reference, phone: result.phone, amount };
      await recordGatewayPayment(db, { ...done, simulated: paymentGateway.simulated });
      setPaid(done);
    } catch (cause) {
      if (cause instanceof GatewayAbortError) {
        setPhase('form');
        return;
      }
      setPhase('form');
      setSaveError(cause instanceof Error ? cause.message : t('pay.error.generic'));
    } finally {
      abort.current = null;
    }
  }

  function cancel() {
    abort.current?.abort();
    onClose();
  }

  // Once the money is in, closing the sheet in any way saves the sale.
  const finish = () => (paid ? onPaid(paid) : cancel());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {t('pay.title')}
            </Text>
            {paymentGateway.simulated ? (
              <View style={styles.simBadge}>
                <Text style={styles.simBadgeText}>{t('pay.simulated')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.amount}>{formatKwacha(amount)}</Text>

          {phase === 'form' ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.body}>
              <Field
                label={t('pay.phone')}
                value={phone}
                onChangeText={changePhone}
                placeholder="097 123 4567"
                keyboardType="phone-pad"
                prefix="+260"
                hint={t('pay.phoneHint')}
                error={phoneError}
                autoFocus
              />
              <View style={styles.providers} accessibilityRole="radiogroup">
                {PROVIDERS.map((option) => (
                  <View key={option} style={styles.provider}>
                    <Choice label={option} selected={provider === option} onPress={() => setProvider(option)} />
                  </View>
                ))}
              </View>
              {saveError ? <FormError message={saveError} /> : null}
              {paymentGateway.simulated ? <Text style={styles.demo}>{t('pay.demoHint')}</Text> : null}
              <Button label={t('pay.send')} icon="send_to_mobile" onPress={send} />
              <Button label={t('common.cancel')} variant="secondary" onPress={cancel} />
            </Animated.View>
          ) : null}

          {busy ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.status}>
              {phase === 'sending' ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <PulsingPhone />
              )}
              <Text style={styles.statusTitle} accessibilityLiveRegion="polite">
                {phase === 'sending'
                  ? t('pay.sending', { phone: normaliseMobile(phone) ?? phone })
                  : t('pay.waiting')}
              </Text>
              {phase === 'waiting' ? <Text style={styles.statusBody}>{t('pay.waitingHint')}</Text> : null}
              <View style={styles.actions}>
                <Button label={t('pay.cancelRequest')} variant="secondary" onPress={cancel} />
              </View>
            </Animated.View>
          ) : null}

          {phase === 'approved' ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.status}>
              {paid ? (
                <>
                  <View style={[styles.statusIcon, styles.statusIconSuccess]}>
                    <Icon name="check" size={36} color={colors.primaryText} />
                  </View>
                  <Text style={styles.statusTitle} accessibilityLiveRegion="polite">
                    {t('pay.approved')}
                  </Text>
                  <Text style={styles.statusBody}>{t('pay.reference', { reference: paid.reference })}</Text>
                  <View style={styles.actions}>
                    <Button label={t('pay.saveSale')} icon="check" onPress={finish} />
                  </View>
                </>
              ) : (
                <ActivityIndicator size="large" color={colors.success} />
              )}
            </Animated.View>
          ) : null}

          {failed ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.status}>
              <View style={[styles.statusIcon, styles.statusIconDanger]}>
                <Icon name={phase === 'timeout' ? 'schedule' : 'close'} size={36} color={colors.danger} />
              </View>
              <Text style={styles.statusTitle} accessibilityLiveRegion="assertive">
                {t(`pay.${phase}`)}
              </Text>
              <Text style={styles.statusBody}>{t(`pay.${phase}Hint`)}</Text>
              <View style={styles.actions}>
                <Button label={t('pay.tryAgain')} icon="refresh" onPress={() => setPhase('form')} />
                <Button label={t('pay.otherWay')} variant="secondary" onPress={cancel} />
              </View>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** A phone that gently pulses while we wait for the customer. */
function PulsingPhone() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1.12, { duration: 650 }), -1, true);
  }, [pulse, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[styles.statusIcon, styles.statusIconWaiting, style]}>
      <Icon name="phone_iphone" size={36} color={colors.primaryInk} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30, 30, 28, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg * 1.5,
    borderTopRightRadius: radii.lg * 1.5,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { fontSize: typeScale.title, fontWeight: '700', color: colors.text, flexShrink: 1 },
  simBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
  },
  simBadgeText: { fontSize: typeScale.caption, fontWeight: '700', color: colors.warning },
  amount: { fontSize: typeScale.display, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  body: { gap: spacing.md, marginTop: spacing.sm },
  providers: { flexDirection: 'row', gap: spacing.sm },
  provider: { flex: 1 },
  demo: { fontSize: typeScale.caption, color: colors.textMuted, lineHeight: 17 },
  status: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, alignSelf: 'stretch' },
  actions: { alignSelf: 'stretch', gap: spacing.sm },
  statusIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  statusIconWaiting: { backgroundColor: colors.primarySoft },
  statusIconSuccess: { backgroundColor: colors.success },
  statusIconDanger: { backgroundColor: colors.dangerSoft },
  statusTitle: { fontSize: typeScale.heading, fontWeight: '700', color: colors.text, textAlign: 'center' },
  statusBody: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
});
