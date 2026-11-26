import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Notice } from '@/components/auth';
import { ConnectDevice } from '@/components/connect-device';
import { Button, Card, Field, Icon, Pill, Row, SectionTitle, TextLink } from '@/components/ui';
import { useShop } from '@/db/hooks';
import { saveSmartInvoiceLink } from '@/db/repos';
import { syncNow } from '@/db/sync';
import { useI18n } from '@/i18n';
import {
  ApiError,
  connectSmartInvoiceOnServer,
  getSmartInvoiceStatusOnServer,
  type SmartInvoiceStatus,
} from '@/lib/api';
import { colors, radii, spacing, themed, typeScale } from '@/theme/tokens';

type Connected = Extract<SmartInvoiceStatus, { connected: true }>;

/**
 * ZRA Smart Invoice, the StockSure way. Shown on the Tax tab (compact) and on
 * its own screen (full). On their own, a trader would have to
 * apply for a VSDC, wait for approval and install software. Here they type
 * their TPIN once and StockSure sends every sale for them.
 *
 * Practice mode: the server talks to a simulated VSDC until ZRA certifies
 * StockSure, and every screen says so.
 */
export function SmartInvoicePanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { deviceToken } = useAuth();
  const { data: shop } = useShop();
  const [status, setStatus] = useState<SmartInvoiceStatus | null>(null);
  const [tpin, setTpin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        if (cause.code === 'offline') return t('si.error.offline');
        if (cause.code === 'validation') return cause.message;
      }
      return t('si.error.server');
    },
    [t]
  );

  const load = useCallback(async () => {
    if (!deviceToken || !shop) return;
    try {
      const next = await getSmartInvoiceStatusOnServer({ deviceToken, shopId: shop.id });
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError(describe(cause));
    }
  }, [deviceToken, describe, shop]);

  useFocusEffect(
    useCallback(() => {
      if (shop?.tpin) setTpin((current) => current || shop.tpin || '');
      void load();
    }, [load, shop])
  );

  async function connect() {
    if (busy) return;
    if (!deviceToken || !shop) {
      // The connect panel above is already showing for a missing key.
      if (!shop) setError(t('si.error.signIn'));
      return;
    }
    const digits = tpin.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError(t('si.error.tpin'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Make sure the server has every sale before it sends them on.
      await syncNow(db, deviceToken).catch(() => undefined);
      const next = await connectSmartInvoiceOnServer({ deviceToken, shopId: shop.id, tpin: digits });
      if (next.connected) {
        await saveSmartInvoiceLink(db, {
          tpin: next.tpin,
          sdcId: next.sdcId,
          connectedAt: next.connectedAt,
          simulated: next.simulated,
        });
        // Bring the ZRA receipt numbers down to this phone.
        await syncNow(db, deviceToken).catch(() => undefined);
      }
      setStatus(next);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (busy) return;
    // The connect panel above is already showing for a missing key.
    if (!deviceToken) return;
    setBusy(true);
    setError(null);
    try {
      await syncNow(db, deviceToken);
      await syncNow(db, deviceToken);
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected ? (status as Connected) : null;

  return (
    <>
      <View style={styles.practice}>
        <Icon name="science" size={20} color={colors.warning} />
        <Text style={styles.practiceText}>{t('si.practice')}</Text>
      </View>

      {/* Smart Invoice talks to the server, so an unconnected phone reconnects
          right here; the status reloads by itself once the key is saved. */}
      {deviceToken ? null : <ConnectDevice />}

      {connected ? (
        <>
          <Notice tone="success">{t('si.connected', { name: connected.taxpayerName })}</Notice>
          <View style={styles.stats}>
            <Stat value={connected.sentCount} label={t('si.stat.sent')} tone="success" />
            <Stat value={connected.waitingCount} label={t('si.stat.waiting')} tone="warning" />
            <Stat value={connected.refundCount} label={t('si.stat.refunds')} tone="neutral" />
          </View>
          {connected.waitingCount > 0 ? <Notice tone="info">{t('si.waitingHint')}</Notice> : null}
          {connected.failedCount > 0 ? (
            <Notice tone="warning">{t('si.failed', { count: connected.failedCount })}</Notice>
          ) : null}

          {compact ? (
            <View style={styles.links}>
              <TextLink accent label={t('si.openDetails')} onPress={() => router.push('/smart-invoice')} />
            </View>
          ) : (
            <>
              <SectionTitle>{t('si.details')}</SectionTitle>
              <Card>
                <Row label={t('si.tpin')} value={connected.tpin} />
                <Row label={t('si.device')} value={connected.sdcId} />
                <Row label={t('si.branch')} value={connected.branchId} />
                <Row label={t('si.since')} value={connected.connectedAt.slice(0, 10)} />
                <Row
                  label={t('si.lastSent')}
                  value={
                    connected.lastSentAt ? connected.lastSentAt.slice(0, 16).replace('T', ' ') : t('common.notYet')
                  }
                />
              </Card>
              <Text style={styles.muted}>{t('si.receiptHint')}</Text>
            </>
          )}
          <Button
            label={busy ? t('si.sending') : t('si.sendNow')}
            variant={compact ? 'secondary' : 'primary'}
            disabled={busy}
            onPress={() => void sendNow()}
          />
        </>
      ) : (
        <>
          <Card>
            <Text style={styles.lead}>{t('si.intro')}</Text>
            <Step n={1} text={t('si.step1')} />
            <Step n={2} text={t('si.step2')} />
            <Step n={3} text={t('si.step3')} />
          </Card>
          <Notice tone="info">{t('si.noForms')}</Notice>
          <Field
            label={t('si.tpin')}
            value={tpin}
            onChangeText={setTpin}
            placeholder="1002003004"
            keyboardType="numeric"
            maxLength={12}
            icon="badge"
            hint={t('si.tpinHint')}
            required
          />
          <Button
            label={busy ? t('si.connecting') : t('si.connect')}
            disabled={busy || tpin.replace(/\D/g, '').length !== 10}
            onPress={() => void connect()}
          />
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNo}>
        <Text style={styles.stepNoText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: 'success' | 'warning' | 'neutral' }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, tone === 'success' && { color: colors.success }]}>{value}</Text>
      <Pill label={label} tone={tone} />
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  practice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningSoft,
  },
  practiceText: { flex: 1, fontSize: typeScale.label, color: colors.text, lineHeight: 18 },
  lead: { fontSize: typeScale.body, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.xs },
  stepNo: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNoText: { fontWeight: '800', color: colors.primaryInk },
  stepText: { flex: 1, fontSize: typeScale.body, color: colors.text },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xs },
  statValue: { fontSize: typeScale.title, fontWeight: '800', color: colors.text },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  links: { alignItems: 'flex-start' },
}));
