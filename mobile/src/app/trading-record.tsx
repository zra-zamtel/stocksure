import * as Print from 'expo-print';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { ConnectNotice } from '@/components/connect-device';
import { EvidenceBreakdown } from '@/components/evidence-breakdown';
import { Button, Card, Choice, IconButton, Pill, Screen, SectionTitle } from '@/components/ui';
import { useShop } from '@/db/hooks';
import { syncNow } from '@/db/sync';
import { useI18n } from '@/i18n';
import {
  ApiError,
  issueTradingRecordOnServer,
  listTradingRecordsOnServer,
  revokeTradingRecordOnServer,
  type IssuedTradingRecord,
  type TradingRecordSummary,
} from '@/lib/api';
import { formatKwacha } from '@/lib/format';
import { longDate, tradingRecordHtml } from '@/lib/trading-record-pdf';
import { colors, radii, spacing, themed, typeScale } from '@/theme/tokens';

type Months = 3 | 6 | 12;
type Expiry = 14 | 30;

/**
 * Trading Record: a sealed summary of the shop's sales the owner can show a
 * bank or MFI. Owner-only, owner-initiated, time-limited and revocable. The
 * server computes the figures from synced records, so the phone syncs first.
 */
export default function TradingRecordScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { deviceToken } = useAuth();
  const { data: shop } = useShop();
  const [months, setMonths] = useState<Months>(6);
  const [expiry, setExpiry] = useState<Expiry>(14);
  const [includeMargin, setIncludeMargin] = useState(false);
  const [includeTax, setIncludeTax] = useState(false);
  const [issued, setIssued] = useState<IssuedTradingRecord | null>(null);
  const [records, setRecords] = useState<TradingRecordSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const describe = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        if (cause.code === 'offline') return t('tr.error.offline');
        if (cause.code === 'validation' || cause.code === 'forbidden') return cause.message;
      }
      return t('tr.error.server');
    },
    [t]
  );

  const load = useCallback(async () => {
    if (!deviceToken || !shop) return;
    try {
      setRecords(await listTradingRecordsOnServer({ deviceToken, shopId: shop.id }));
    } catch (cause) {
      setError(describe(cause));
    }
  }, [deviceToken, describe, shop]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function create() {
    if (busy || !deviceToken || !shop) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // The record is built from what the server has, so send today's sales first.
      await syncNow(db, deviceToken).catch(() => undefined);
      const record = await issueTradingRecordOnServer({
        deviceToken,
        shopId: shop.id,
        months,
        expiresInDays: expiry,
        includeMargin,
        includeTax,
      });
      setIssued(record);
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  async function sharePdf() {
    if (!issued || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: tradingRecordHtml(issued) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: t('tr.sharePdf'),
        });
      } else {
        await Print.printAsync({ uri });
      }
    } catch {
      setError(t('tr.error.pdf'));
    } finally {
      setBusy(false);
    }
  }

  async function shareLink() {
    if (!issued || busy) return;
    await Share.share({
      message: t('tr.shareMessage', { name: issued.payload.business.name, url: issued.verifyUrl }),
    }).catch(() => undefined);
  }

  function confirmRevoke(id: string) {
    Alert.alert(t('tr.revokeTitle'), t('tr.revokeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('tr.revoke'), style: 'destructive', onPress: () => void revoke(id) },
    ]);
  }

  async function revoke(id: string) {
    if (!deviceToken || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeTradingRecordOnServer({ deviceToken, id });
      if (issued?.id === id) setIssued(null);
      setMessage(t('tr.revoked'));
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const totals = issued?.payload.totals;

  return (
    <Screen
      title={t('tr.title')}
      subtitle={t('tr.subtitle')}
      action={<IconButton name="close" label={t('common.back')} onPress={() => router.back()} />}
    >
      {deviceToken ? null : <ConnectNotice title={t('connect.forRecord')} />}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {issued && totals ? (
        <Card>
          <Notice tone="success">{t('tr.ready', { date: longDate(issued.expiresAt) })}</Notice>
          <Text style={styles.cardTitle}>
            {issued.payload.business.name} · {longDate(issued.periodStart)} – {longDate(issued.periodEnd)}
          </Text>
          <EvidenceBreakdown totals={totals} />
          <View style={styles.sealBox} accessible accessibilityLabel={t('tr.seal', { seal: issued.seal })}>
            <Text style={styles.sealCaption}>{t('tr.sealCaption')}</Text>
            <Text style={styles.seal}>{issued.seal}</Text>
          </View>
          {issued.payload.data.synced_late_value > 0 ? (
            <Notice tone="info">
              {t('tr.lateNote', { amount: formatKwacha(issued.payload.data.synced_late_value) })}
            </Notice>
          ) : null}
          <View style={styles.buttons}>
            <Button label={t('tr.sharePdf')} icon="picture_as_pdf" onPress={sharePdf} loading={busy} />
            <Button label={t('tr.shareLink')} icon="link" variant="secondary" onPress={shareLink} disabled={busy} />
          </View>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.body}>{t('tr.intro')}</Text>
            <Text style={styles.muted}>{t('tr.notThis')}</Text>
          </Card>

          <SectionTitle>{t('tr.period')}</SectionTitle>
          <Text style={styles.help}>{t('tr.periodHelp')}</Text>
          <View style={styles.choices}>
            {([3, 6, 12] as const).map((value) => (
              <Choice
                key={value}
                label={t('tr.months', { count: value })}
                selected={months === value}
                onPress={() => setMonths(value)}
              />
            ))}
          </View>

          <SectionTitle>{t('tr.expiry')}</SectionTitle>
          <View style={styles.choices}>
            {([14, 30] as const).map((value) => (
              <Choice
                key={value}
                label={t('tr.days', { count: value })}
                selected={expiry === value}
                onPress={() => setExpiry(value)}
              />
            ))}
          </View>

          <SectionTitle>{t('tr.optional')}</SectionTitle>
          <Choice
            kind="checkbox"
            icon="trending_up"
            label={t('tr.includeMargin')}
            selected={includeMargin}
            onPress={() => setIncludeMargin((on) => !on)}
          />
          <Choice
            kind="checkbox"
            icon="receipt_long"
            label={t('tr.includeTax')}
            selected={includeTax}
            onPress={() => setIncludeTax((on) => !on)}
          />

          <View style={styles.consent}>
            <Text style={styles.muted}>{t('tr.consent')}</Text>
          </View>
          <Button
            label={t('tr.create')}
            icon="verified"
            onPress={create}
            loading={busy}
            disabled={!deviceToken || !shop}
          />
        </>
      )}

      {records.length > 0 ? (
        <>
          <SectionTitle>{t('tr.history')}</SectionTitle>
          {records.map((record) => (
            <Card key={record.id}>
              <View style={styles.recordHead}>
                <Text style={styles.recordTitle}>
                  {longDate(record.periodStart)} – {longDate(record.periodEnd)}
                </Text>
                <Pill
                  label={t(`tr.state.${record.state}`)}
                  tone={record.state === 'valid' ? 'success' : 'neutral'}
                />
              </View>
              <Text style={styles.muted}>
                {t('tr.recordMeta', {
                  issued: longDate(record.issuedAt),
                  expires: longDate(record.expiresAt),
                  views: record.viewCount,
                })}
              </Text>
              <Text style={styles.muted}>{t('tr.seal', { seal: record.seal })}</Text>
              {record.state === 'valid' ? (
                <Button
                  label={t('tr.revoke')}
                  icon="block"
                  variant="secondary"
                  onPress={() => confirmRevoke(record.id)}
                  disabled={busy}
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    body: { color: colors.text, fontSize: typeScale.body, lineHeight: 22 },
    muted: { color: colors.textMuted, fontSize: typeScale.label, lineHeight: 18, marginTop: spacing.xs },
    choices: { gap: spacing.sm },
    buttons: { gap: spacing.sm, marginTop: spacing.md },
    help: { color: colors.textMuted, fontSize: typeScale.label, lineHeight: 18, marginBottom: spacing.sm },
    consent: { marginVertical: spacing.md },
    cardTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: '600', marginVertical: spacing.md },
    sealBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    sealCaption: { color: colors.textMuted, fontSize: typeScale.caption },
    seal: {
      color: colors.text,
      fontSize: typeScale.heading,
      fontFamily: 'monospace',
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: spacing.xxs,
    },
    recordHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    recordTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: '600', flexShrink: 1 },
  })
);
