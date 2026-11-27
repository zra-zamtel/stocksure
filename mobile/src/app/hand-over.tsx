import { useRouter } from 'expo-router';
import type { AndroidSymbol } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HandOverError, useAuth } from '@/auth/session';
import { ConnectSheet } from '@/components/connect-device';
import { Button, Card, Field, Icon, Screen, SectionTitle } from '@/components/ui';
import { resetSyncProblem, useSync } from '@/db/use-sync';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { colors, fonts, iconSize, radii, spacing, themed, typeScale } from '@/theme/tokens';

/**
 * Hand over this phone: back everything up, confirm with the owner PIN, then
 * clear the phone so the next person starts like a new install. Each step says
 * whether it is done and, if not, the one thing that finishes it, so the clear
 * button is never disabled without a reason on screen.
 */
export default function HandOverScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { deviceToken, handOverPhone } = useAuth();
  const sync = useSync();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const connected = deviceToken !== null;
  const backedUp = connected && sync.pending === 0 && sync.lastSyncAt !== null && sync.problem === null;

  async function clearPhone() {
    setError(null);
    setPinError(null);
    if (!backedUp) {
      setError(t('handOver.error.notBackedUp'));
      return;
    }
    if (pin.length < 4) {
      setPinError(t('handOver.error.pinMissing'));
      return;
    }
    setClearing(true);
    try {
      await handOverPhone(pin);
      resetSyncProblem();
      // The phone has no account now; the gate opens setup like a new install,
      // and that first screen says the phone was cleared.
      router.replace('/');
    } catch (cause) {
      setClearing(false);
      setPin('');
      if (cause instanceof HandOverError && cause.reason === 'pin') {
        setPinError(t('handOver.error.pin'));
      } else if (cause instanceof HandOverError && cause.reason === 'pending') {
        // Something was recorded meanwhile: upload it first.
        void sync.refresh();
        setError(t('handOver.error.pending'));
      } else {
        setError(t('handOver.error.generic'));
      }
    }
  }

  const backupStep: { done: boolean; text: string; action?: ReactNode } = !connected
    ? {
        done: false,
        text: t('handOver.backup.notConnected'),
        action: <Button label={t('handOver.backup.connect')} icon="link" variant="secondary" onPress={() => setConnectOpen(true)} />,
      }
    : backedUp
      ? {
          done: true,
          text: t('handOver.backup.done', { time: formatDateTime(sync.lastSyncAt!) }),
        }
      : {
          done: false,
          text:
            sync.problem === 'offline'
              ? t('handOver.backup.offline', { count: sync.pending })
              : sync.pending > 0
                ? t('handOver.backup.waiting', { count: sync.pending })
                : t('handOver.backup.never'),
          action: (
            <Button
              label={sync.busy ? t('sync.syncing') : t('handOver.backup.upload')}
              icon="cloud_upload"
              variant="secondary"
              loading={sync.busy}
              onPress={() => void sync.syncNow()}
            />
          ),
        };

  return (
    <Screen back title={t('handOver.title')} subtitle={t('handOver.subtitle')}>
      <Card>
        <Fact icon="delete" tone="danger" text={t('handOver.clears')} />
        <Fact icon="cloud_done" tone="success" text={t('handOver.keeps')} />
      </Card>

      <SectionTitle>{t('handOver.steps')}</SectionTitle>

      <Step n={1} title={t('handOver.backup.title')} done={backupStep.done} text={backupStep.text}>
        {backupStep.action}
      </Step>

      <Step
        n={2}
        title={t('handOver.confirm.title')}
        done={false}
        disabled={!backedUp}
        text={backedUp ? t('handOver.confirm.text') : t('handOver.confirm.waiting')}
      >
        {backedUp ? (
          <Field
            label={t('handOver.confirm.pin')}
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/\D/g, ''));
              if (pinError) setPinError(null);
            }}
            keyboardType="numeric"
            secureTextEntry
            maxLength={8}
            error={pinError}
            revealLabels={{ show: t('common.showTyped'), hide: t('common.hideTyped') }}
          />
        ) : null}
      </Step>

      <Step n={3} title={t('handOver.clear.title')} done={false} disabled={!backedUp} text={t('handOver.clear.text')}>
        <Button
          label={t('handOver.clear.action')}
          icon="phonelink_erase"
          variant="danger"
          disabled={!backedUp}
          loading={clearing}
          onPress={() => void clearPhone()}
        />
      </Step>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}

      <ConnectSheet
        visible={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          void sync.syncNow();
        }}
      />
    </Screen>
  );
}

function Fact({ icon, tone, text }: { icon: AndroidSymbol; tone: 'danger' | 'success'; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={iconSize.md} color={tone === 'danger' ? colors.danger : colors.success} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

/** A numbered step: a tick once done, a faded look (with the reason) while it waits. */
function Step({
  n,
  title,
  text,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  text: string;
  done: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card>
      <View style={[styles.stepHead, disabled && styles.stepWaiting]}>
        <View style={[styles.stepNo, done && styles.stepNoDone]}>
          {done ? (
            <Icon name="check" size={iconSize.sm} color={colors.primaryText} />
          ) : (
            <Text style={styles.stepNoText}>{n}</Text>
          )}
        </View>
        <View style={styles.stepBody}>
          <Text style={styles.stepTitle} accessibilityRole="header">
            {title}
          </Text>
          <Text style={[styles.stepText, done && styles.stepTextDone]} accessibilityLiveRegion="polite">
            {text}
          </Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  factText: { flex: 1, fontSize: typeScale.body, lineHeight: 22, color: colors.text },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepWaiting: { opacity: 0.6 },
  stepNo: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  stepNoDone: { backgroundColor: colors.success },
  stepNoText: { fontFamily: fonts.display, fontSize: typeScale.label, color: colors.text },
  stepBody: { flex: 1, gap: 2 },
  stepTitle: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  stepText: { fontSize: typeScale.label, lineHeight: 19, color: colors.textMuted },
  stepTextDone: { color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
}));
