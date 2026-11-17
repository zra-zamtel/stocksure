import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, Screen, SectionTitle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, spacing, typeScale } from '@/theme/tokens';

export default function NewProductScreen() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <Screen
      title={t('product.new.title')}
      footer={
        <View style={styles.footer}>
          <Button label={t('products.scanBarcode')} variant="secondary" />
          <Button label={t('common.save')} onPress={() => router.back()} />
        </View>
      }
    >
      <SectionTitle>{t('product.new.name')}</SectionTitle>
      <Card>
        <Field label={t('product.new.name')} placeholder="Black school shoes, size 42" required />
        <Field label={t('product.new.category')} placeholder="Shoes" />
        <Field label={t('product.new.barcode')} placeholder="Scan or generate" />
      </Card>

      <SectionTitle>{t('products.buyPrice')}</SectionTitle>
      <Card>
        <Field label={t('products.buyPrice')} placeholder="180.00" keyboardType="decimal-pad" required />
        <Field label={t('products.sellPrice')} placeholder="280.00" keyboardType="decimal-pad" required />
        <Field label={t('product.new.discount')} placeholder={t('common.optional')} keyboardType="decimal-pad" />
      </Card>

      <SectionTitle>{t('products.inStock')}</SectionTitle>
      <Card>
        <Field label={t('product.new.openingQty')} placeholder="6" keyboardType="numeric" required />
        <Field label={t('product.new.lowStock')} placeholder="3" keyboardType="numeric" />
      </Card>

      <Text style={styles.hint}>
        Saves to SQLite via the shared core module, then queues a sync item (#3, #4).
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.sm },
  hint: { fontSize: typeScale.caption, color: colors.textMuted },
});
