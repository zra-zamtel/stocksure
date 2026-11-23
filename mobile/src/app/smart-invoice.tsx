import { useRouter } from 'expo-router';
import { SmartInvoicePanel } from '@/components/smart-invoice-panel';
import { IconButton, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';

/** The full Smart Invoice view; the Tax tab shows the same panel in short form. */
export default function SmartInvoiceScreen() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen
      title={t('si.title')}
      subtitle={t('si.subtitle')}
      action={<IconButton name="close" label={t('common.back')} onPress={() => router.back()} />}
    >
      <SmartInvoicePanel />
    </Screen>
  );
}
