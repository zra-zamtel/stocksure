import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { findVariantByBarcode } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

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

export default function ScanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan(result: BarcodeScanningResult) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const match = await findVariantByBarcode(db, result.data);
      if (match) {
        router.replace(`/product/${match.productId}`);
      } else {
        router.replace({ pathname: '/product/new', params: { barcode: result.data } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that barcode');
      setBusy(false);
    }
  }

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
        <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        onBarcodeScanned={busy ? undefined : handleScan}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
      />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <View style={styles.topButton}>
            <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
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

        <View style={styles.bottom}>
          <Text style={styles.hintLight}>{busy ? t('scan.scanning') : t('scan.hint')}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  bottom: { gap: spacing.sm },
  hintLight: { color: '#FFFFFF', fontSize: typeScale.body, textAlign: 'center' },
  error: { color: '#FFB4AB', fontSize: typeScale.label, textAlign: 'center' },
  fallback: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: { fontSize: typeScale.title, fontWeight: '700', color: colors.text },
  hint: { fontSize: typeScale.body, color: colors.textMuted },
});
