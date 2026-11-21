import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { isValidPhone, newId, normalisePhone, type Provider } from '@/core';
import { useI18n } from '@/i18n';
import {
  ApiError,
  paymentRequestStatusOnServer,
  requestToPayOnServer,
  type PaymentRequest,
} from '@/lib/api';
import { formatKwacha } from '@/lib/format';
import { spacing } from '@/theme/tokens';
import { Notice } from './auth';
import { Button, Field, TextLink } from './ui';

const POLL_MS = 2000;

export type PaidRequest = { reference: string; phone: string; amount: number; provider: Provider; at: string };

/**
 * "Ask customer to pay": the cashier types the customer's number, the
 * customer gets a prompt on their own phone and approves it with their PIN.
 * The panel checks every two seconds until the payment is approved, declined
 * or times out, then hands the provider's reference to the sale.
 */
export function RequestToPay({
  provider,
  amount,
  paid,
  onPaid,
  onClear,
}: {
  provider: Provider;
  amount: number;
  paid: PaidRequest | null;
  onPaid: (paid: PaidRequest) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const { deviceToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  // Poll while the customer decides. Stops when the answer is final or the
  // panel goes away.
  useEffect(() => {
    if (!request || request.status !== 'pending' || !deviceToken) return;
    let stopped = false;
    const timer = setInterval(() => {
      paymentRequestStatusOnServer({ id: request.id, deviceToken })
        .then((next) => {
          if (stopped) return;
          setRequest(next);
          if (next.status === 'successful') {
            onPaidRef.current({
              reference: next.reference,
              phone: next.phone,
              amount: next.amount,
              provider: next.provider,
              at: next.completedAt ?? new Date().toISOString(),
            });
          }
        })
        .catch(() => {
          // A missed poll is retried on the next tick; the server keeps the answer.
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [deviceToken, request]);

  async function send() {
    setError(null);
    if (!deviceToken) return setError(t('rtp.error.signIn'));
    if (!isValidPhone(phone)) return setError(t('rtp.error.phone'));
    setSending(true);
    try {
      const created = await requestToPayOnServer({
        id: newId('rtp'),
        provider,
        phone: normalisePhone(phone),
        amount,
        deviceToken,
      });
      setRequest(created);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'offline'
          ? t('rtp.error.offline')
          : cause instanceof Error
            ? cause.message
            : t('rtp.error.server')
      );
    } finally {
      setSending(false);
    }
  }

  function again() {
    setRequest(null);
    setError(null);
    onClear();
  }

  if (paid) {
    return (
      <Notice tone="success" action={<TextLink label={t('rtp.cancel')} onPress={again} />}>
        {t('rtp.paid', { amount: formatKwacha(paid.amount), reference: paid.reference })}
      </Notice>
    );
  }

  if (request?.status === 'pending') {
    return (
      <Notice tone="info" action={<TextLink label={t('rtp.cancel')} onPress={again} />}>
        {t('rtp.waiting', { amount: formatKwacha(request.amount), phone: request.phone })}
      </Notice>
    );
  }

  return (
    <View style={styles.box}>
      {request && request.status !== 'successful' ? (
        <Notice tone="warning">
          {request.status === 'expired' ? t('rtp.expired') : request.reason || t('rtp.failed')}
        </Notice>
      ) : null}
      <Field
        label={t('rtp.phone')}
        value={phone}
        onChangeText={setPhone}
        placeholder="97 123 4567"
        keyboardType="phone-pad"
        prefix="+260"
      />
      <Button
        label={sending ? t('rtp.sending') : t('rtp.ask', { amount: formatKwacha(amount) })}
        icon="send_to_mobile"
        disabled={amount <= 0 || phone.trim() === ''}
        loading={sending}
        onPress={() => void send()}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
});
