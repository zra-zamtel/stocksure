import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

// Retail formats only: QR, PDF417 and friends are not product codes.
const BARCODE_TYPES = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'itf14',
  'codabar',
] as const;

type Props = {
  onScanned: (code: string) => void;
  onClose: () => void;
};

/**
 * Full-screen camera scanner. It reports the first successful read once and
 * then ignores the stream, so a barcode held in frame cannot add the same item
 * five times before the parent closes it.
 */
export function BarcodeScanner({ onScanned, onClose }: Props) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [handled, setHandled] = useState(false);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (handled) return;
      setHandled(true);
      onScanned(result.data);
    },
    [handled, onScanned]
  );

  if (!permission) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.hint}>{t('scan.permissionBody')}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.title}>{t('scan.permissionTitle')}</Text>
        <Text style={styles.hint}>{t('scan.permissionBody')}</Text>
        <Button label={t('scan.grant')} onPress={requestPermission} />
        <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        onBarcodeScanned={handled ? undefined : handleScan}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
      />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <View style={styles.topButton}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
          </View>
          <View style={styles.topButton}>
            <Button
              label={torch ? t('scan.torchOn') : t('scan.torch')}
              variant="secondary"
              onPress={() => setTorch((value) => !value)}
            />
          </View>
        </View>

        <View style={styles.frame} />

        <Text style={styles.hintLight}>{handled ? t('scan.scanning') : t('scan.hint')}</Text>
      </SafeAreaView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  topRow: { flexDirection: 'row', gap: spacing.md },
  topButton: { flex: 1 },
  frame: {
    alignSelf: 'center',
    width: '86%',
    height: 160,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 12,
  },
  hintLight: { color: '#FFFFFF', fontSize: typeScale.body, textAlign: 'center' },
  fallback: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: { fontSize: typeScale.title, fontWeight: '700', color: colors.text },
  hint: { fontSize: typeScale.body, color: colors.textMuted },
}));
