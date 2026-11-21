import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { Hint, Notice } from '@/components/auth';
import { Toggle } from '@/components/charts';
import { SetupStep } from '@/components/onboarding';
import { Button, Field, TextLink } from '@/components/ui';
import { parsePaymentMessage, PermissionError, toNgwee, type Provider } from '@/core';
import { addPaymentMessage, DuplicateMessageError, reconcileDay } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';

const PROVIDERS: Provider[] = ['MTN', 'Airtel', 'Zamtel'];

type Outcome = { kind: 'matched'; amount: number; at: string } | { kind: 'waiting' };

/**
 * The owner copies a "you have received" message from their SMS app and
 * pastes it here. What can be read is filled in; the owner checks it and
 * types what is missing. Saving runs the matcher at once, so the owner sees
 * straight away whether it settled a sale.
 */
export default function PaymentMessageScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const guard = usePermissionGuard();

  const [raw, setRaw] = useState('');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [sender, setSender] = useState('');
  const [receivedAt, setReceivedAt] = useState<string | undefined>();
  const [outgoing, setOutgoing] = useState(false);
  const [readAmount, setReadAmount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function onPaste(text: string) {
    setRaw(text);
    setError(null);
    const parsed = parsePaymentMessage(text);
    if (parsed.provider) setProvider(parsed.provider);
    setAmount(parsed.amount ? (parsed.amount / 100).toFixed(2) : '');
    setReadAmount(Boolean(parsed.amount));
    setReference(parsed.reference ?? '');
    setSender(parsed.sender ?? '');
    setReceivedAt(parsed.receivedAt);
    setOutgoing(parsed.outgoing);
  }

  function reset() {
    onPaste('');
    setProvider(null);
    setOutcome(null);
  }

  async function save() {
    if (saving) return;
    setError(null);
    const value = toNgwee(Number.parseFloat(amount.replace(/,/g, '')) || 0);
    if (!provider) return setError(t('payMsg.error.provider'));
    if (value <= 0) return setError(t('payMsg.error.amount'));

    setSaving(true);
    try {
      guard('reconcile.resolve');
      const txnId = await addPaymentMessage(db, {
        provider,
        amount: value,
        reference: reference || undefined,
        sender: sender || undefined,
        receivedAt,
        rawMessage: raw,
        parsed: readAmount,
      });
      const day = await reconcileDay(db);
      const match = day.matched.find((item) => item.txnId === txnId);
      setOutcome(match ? { kind: 'matched', amount: match.amount, at: match.at } : { kind: 'waiting' });
    } catch (cause) {
      setError(
        cause instanceof DuplicateMessageError
          ? t('payMsg.error.duplicate')
          : cause instanceof PermissionError
            ? t('permission.denied')
            : cause instanceof Error
              ? cause.message
              : t('payMsg.error.save')
      );
    } finally {
      setSaving(false);
    }
  }

  const footer = outcome ? (
    <View style={styles.footer}>
      <Button label={t('payMsg.another')} onPress={reset} />
      <TextLink label={t('payMsg.done')} onPress={() => router.back()} />
    </View>
  ) : (
    <Button
      label={saving ? t('common.saving') : t('payMsg.save')}
      disabled={saving || raw.trim() === '' || amount.trim() === ''}
      onPress={() => void save()}
    />
  );

  return (
    <SetupStep
      eyebrow={t('reconcile.title')}
      title={t('payMsg.title')}
      subtitle={t('payMsg.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={footer}
    >
      {outcome ? (
        outcome.kind === 'matched' ? (
          <Notice tone="success">
            {t('payMsg.matched', {
              amount: formatKwacha(outcome.amount),
              time: new Date(outcome.at).toTimeString().slice(0, 5),
            })}
          </Notice>
        ) : (
          <Notice tone="info">{t('payMsg.waiting')}</Notice>
        )
      ) : (
        <>
          <View style={styles.pasteBox}>
            <TextInput
              value={raw}
              onChangeText={onPaste}
              placeholder={t('payMsg.placeholder')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('payMsg.title')}
              multiline
              textAlignVertical="top"
              autoCorrect={false}
              style={styles.pasteInput}
            />
          </View>
          <Hint icon="content_paste">{t('payMsg.how')}</Hint>

          {raw.trim() ? (
            <>
              {outgoing ? <Notice tone="warning">{t('payMsg.outgoing')}</Notice> : null}
              <Text style={styles.section}>{t('payMsg.check')}</Text>
              <Toggle
                options={PROVIDERS.map((value) => ({ value, label: value }))}
                value={provider ?? ('' as Provider)}
                onChange={setProvider}
              />
              <Field
                label={t('payMsg.amount')}
                value={amount}
                onChangeText={(value) => {
                  setAmount(value);
                  setReadAmount(false);
                }}
                placeholder="0.00"
                keyboardType="decimal-pad"
                prefix="K"
                required
              />
              <Field
                label={t('payMsg.reference')}
                value={reference}
                onChangeText={setReference}
                placeholder={t('common.optional')}
                autoCapitalize="characters"
                icon="tag"
              />
              {sender ? <Hint icon="person">{t('payMsg.from', { sender })}</Hint> : null}
              {!readAmount && amount === '' ? <Hint icon="info">{t('payMsg.cantRead')}</Hint> : null}
            </>
          ) : null}
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </SetupStep>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs },
  pasteBox: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 120,
  },
  pasteInput: {
    minHeight: 120,
    padding: spacing.md,
    fontSize: typeScale.body,
    color: colors.text,
  },
  section: {
    fontSize: typeScale.label,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.text,
    marginTop: spacing.sm,
  },
});
