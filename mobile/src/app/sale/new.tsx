import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Choice, EmptyState, Field, Row, Screen, SectionTitle } from '@/components/ui';
import { products } from '@/data/fake';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, typeScale } from '@/theme/tokens';

type Line = { variantId: string; productName: string; label: string; price: number; quantity: number };

export default function NewSaleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<'cash' | 'mobile_money' | 'split'>('cash');

  const total = useMemo(() => lines.reduce((sum, line) => sum + line.price * line.quantity, 0), [lines]);

  const add = (productName: string, variantId: string, label: string, price: number) => {
    setLines((current) => {
      const existing = current.find((line) => line.variantId === variantId);
      if (existing) {
        return current.map((line) =>
          line.variantId === variantId ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [...current, { variantId, productName, label, price, quantity: 1 }];
    });
  };

  return (
    <Screen
      title={t('sale.new.title')}
      footer={<Button label={t('sale.new.confirm')} disabled={lines.length === 0} onPress={() => router.replace('/(tabs)/sales')} />}
    >
      <SectionTitle>{t('sale.new.addItem')}</SectionTitle>
      {products.map((product) => {
        const variant = product.variants[0];
        const label = [variant.size, variant.colour].filter(Boolean).join(' · ') || 'Single';
        return (
          <Pressable
            key={product.id}
            onPress={() => add(product.name, variant.id, label, variant.sellPrice)}
            style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
          >
            <View>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.muted}>{label}</Text>
            </View>
            <Text style={styles.price}>{formatKwacha(variant.sellPrice)}</Text>
          </Pressable>
        );
      })}

      <SectionTitle>{t('sales.items')}</SectionTitle>
      {lines.length === 0 ? (
        <EmptyState message={t('sale.new.empty')} />
      ) : (
        <Card>
          {lines.map((line) => (
            <Row
              key={line.variantId}
              label={`${line.productName} ${line.label} × ${line.quantity}`}
              value={formatKwacha(line.price * line.quantity)}
            />
          ))}
        </Card>
      )}

      <SectionTitle>{t('sale.new.paymentMethod')}</SectionTitle>
      <View style={styles.methods}>
        <Choice label={t('sale.new.cash')} selected={method === 'cash'} onPress={() => setMethod('cash')} />
        <Choice
          label={t('sale.new.mobileMoney')}
          selected={method === 'mobile_money'}
          onPress={() => setMethod('mobile_money')}
        />
        <Choice label={t('sale.new.split')} selected={method === 'split'} onPress={() => setMethod('split')} />
      </View>

      {method !== 'cash' ? (
        <Card>
          <Field label={t('sale.new.reference')} placeholder="MP2607.1122.A84721" />
        </Card>
      ) : null}

      <Card>
        <Row label={t('sales.total')} value={formatKwacha(total)} emphasis />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  pressed: { opacity: 0.6 },
  name: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
  muted: { fontSize: typeScale.caption, color: colors.textMuted },
  price: { fontSize: typeScale.body, color: colors.text, fontVariant: ['tabular-nums'] },
  methods: { gap: spacing.sm },
});
