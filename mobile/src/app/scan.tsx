import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { findVariantByBarcode } from '@/db/repos';

export default function ScanScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [error, setError] = useState<string | null>(null);

  async function handleScanned(code: string) {
    try {
      const match = await findVariantByBarcode(db, code);
      if (match) {
        router.replace(`/product/${match.productId}`);
      } else {
        router.replace({
          pathname: '/product/new',
          params: from ? { barcode: code, from } : { barcode: code },
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that barcode');
    }
  }

  return (
    <>
      <BarcodeScanner onScanned={handleScanned} onClose={() => router.back()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  error: { position: 'absolute', bottom: 24, left: 24, right: 24, color: '#FFB4AB' },
});
