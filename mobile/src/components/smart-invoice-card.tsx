import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { useSmartInvoice } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { getSmartInvoiceSaleOnServer, type SmartInvoiceSent } from '@/lib/api';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';
import { Card, Pill, Row, SectionTitle, TextLink } from './ui';

/** Signatures read better in groups of four: TQZM-KL57-AGBM-STPO. */
function group(value: string | undefined): string {
  return value ? (value.match(/.{1,4}/g) ?? [value]).join('-') : '-';
}

const PAYMENT_NAMES: Record<string, string> = { '01': 'Cash', '06': 'Mobile money', '07': 'Other' };

/**
 * The Smart Invoice status of one sale. The trader only needs "Sent" or
 * "Waiting"; the numbers below are what a ZRA officer would ask for.
 */
export function SmartInvoiceCard({ saleId }: { saleId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { can, deviceToken } = useAuth();
  const { data } = useSmartInvoice(saleId);
  const [sent, setSent] = useState<SmartInvoiceSent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const isOwner = can('settings.view');

  if (!data.link) {
    if (!isOwner) return null;
    return (
      <>
        <SectionTitle>{t('si.card.title')}</SectionTitle>
        <Card>
          <Text style={styles.muted}>{t('si.card.notConnected')}</Text>
          <TextLink accent label={t('si.card.connect')} onPress={() => router.push('/smart-invoice')} />
        </Card>
      </>
    );
  }

  const sale = data.receipts.find((r) => r.receiptType === 'S');
  const refund = data.receipts.find((r) => r.receiptType === 'R');
  const ok = sale?.resultCode === '000';

  async function showSent() {
    if (!deviceToken || loading) return;
    setLoading(true);
    setLoadError(false);
    try {
      setSent(await getSmartInvoiceSaleOnServer({ deviceToken, saleId }));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  const request = sent?.find((r) => r.receiptType === 'S')?.request;
  const items = Array.isArray(request?.itemList) ? (request.itemList as Record<string, unknown>[]) : [];

  return (
    <>
      <SectionTitle>{t('si.card.title')}</SectionTitle>
      <Card>
        <View style={styles.head}>
          <Pill
            label={!sale ? t('si.card.waiting') : ok ? t('si.card.sent') : t('si.card.failed')}
            tone={!sale ? 'warning' : ok ? 'success' : 'danger'}
          />
          {data.link.simulated || sale?.simulated ? <Pill label={t('si.card.practice')} tone="neutral" /> : null}
        </View>

        {!sale ? <Text style={styles.muted}>{t('si.card.waitingHint')}</Text> : null}
        {sale && !ok ? <Text style={styles.muted}>{sale.resultMessage}</Text> : null}

        {sale && ok ? (
          <>
            <Row label={t('si.card.invoiceNo')} value={String(sale.invoiceNo)} />
            <Row label={t('si.card.receiptNo')} value={String(sale.receiptNo ?? '-')} />
            <Row label={t('si.card.signature')} value={group(sale.receiptSignature)} />
            <Row label={t('si.device')} value={sale.sdcId ?? '-'} />
            {sale.publishedAt ? (
              <Row label={t('si.card.sentAt')} value={formatDateTime(sale.publishedAt)} />
            ) : null}
          </>
        ) : null}

        {refund ? (
          <Row
            label={t('si.card.refund')}
            value={refund.resultCode === '000' ? `#${refund.invoiceNo}` : t('si.card.failed')}
          />
        ) : null}

        {isOwner && sale ? (
          sent ? (
            <View style={styles.sent}>
              <Text style={styles.sentTitle}>{t('si.card.whatWasSent')}</Text>
              <Row label={t('si.card.taxType')} value={`${t('si.card.turnoverTax')} (TOT)`} />
              <Row
                label={t('si.card.paymentCode')}
                value={`${PAYMENT_NAMES[String(request?.pmtTyCd)] ?? '-'} (${String(request?.pmtTyCd ?? '-')})`}
              />
              <Row label={t('si.card.items')} value={String(items.length)} />
              <Row label={t('si.card.total')} value={`K${Number(request?.totAmt ?? 0).toFixed(2)}`} />
              {items.map((item) => (
                <Text key={String(item.itemSeq)} style={styles.code}>
                  {`${String(item.itemCd)} · ${String(item.itemNm)} × ${String(item.qty)}`}
                </Text>
              ))}
            </View>
          ) : (
            <TextLink
              accent
              label={loading ? t('si.sending') : t('si.card.showSent')}
              onPress={() => void showSent()}
            />
          )
        ) : null}
        {loadError ? <Text style={styles.muted}>{t('si.error.offline')}</Text> : null}
      </Card>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  head: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  sent: { gap: spacing.xs, marginTop: spacing.sm },
  sentTitle: { fontSize: typeScale.label, fontWeight: '800', color: colors.text },
  code: { fontSize: typeScale.caption, color: colors.textMuted, fontFamily: 'monospace' },
}));
