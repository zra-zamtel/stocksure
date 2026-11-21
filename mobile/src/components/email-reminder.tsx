import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { readEmailPending } from '@/lib/email-verify-store';
import { useI18n } from '@/i18n';
import { Notice } from './auth';
import { TextLink } from './ui';

/**
 * "Confirm your email" reminder shown after sign-up until the emailed link
 * is opened. It names the address and offers to send the link again, since a
 * first email can land in spam or fail to send.
 */
export function EmailReminder() {
  const { t } = useI18n();
  const { ownerPreview, requestOwnerMagicLink, user } = useAuth();
  const [pending] = useState(readEmailPending);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (!pending || user?.role !== 'owner') return null;

  async function resend() {
    if (!pending || state === 'sending') return;
    setState('sending');
    try {
      await requestOwnerMagicLink(pending.email, ownerPreview?.phone);
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  const message =
    state === 'sent'
      ? t('verify.resent', { email: pending.email })
      : state === 'failed'
        ? t('verify.failed')
        : pending.sent
          ? t('verify.sent', { email: pending.email })
          : t('verify.notSent', { email: pending.email });

  return (
    <Notice
      tone={state === 'failed' || (!pending.sent && state === 'idle') ? 'warning' : 'info'}
      action={
        state === 'sent' ? undefined : (
          <View style={styles.action}>
            <TextLink
              accent
              label={state === 'sending' ? t('verify.sending') : t('verify.resend')}
              onPress={() => void resend()}
            />
          </View>
        )
      }
    >
      {message}
    </Notice>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'flex-start' },
});
