import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { Button, Icon, IconButton, Pill, Screen } from '@/components/ui';
import { useProducts, useShop } from '@/db/hooks';
import type { ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, radii, spacing, touch, typeScale } from '@/theme/tokens';

type Filter = 'all' | 'low' | 'out';

function worstState(product: ProductWithStock): 'ok' | 'low' | 'out' {
  return product.variants.reduce<'ok' | 'low' | 'out'>((worst, variant) => {
    if (variant.state === 'out') return 'out';
    if (variant.state === 'low' && worst === 'ok') return 'low';
    return worst;
  }, 'ok');
}

/**
 * The stock list. Three counts at the top double as filters, so "what is
 * running out?" is one tap. Each product is a single row; tapping it opens the
 * product, where restocking lives.
 */
export default function ProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const { data: products, loading, error } = useProducts();
  const { data: shop } = useShop();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const managesProducts = can('products.manage');
  const states = new Map(products.map((product) => [product.id, worstState(product)]));
  const counts = {
    all: products.length,
    low: products.filter((product) => states.get(product.id) === 'low').length,
    out: products.filter((product) => states.get(product.id) === 'out').length,
  };

  const needle = query.trim().toLowerCase();
  const visible = products.filter((product) => {
    if (filter !== 'all' && states.get(product.id) !== filter) return false;
    if (!needle) return true;
    return [product.name, product.category ?? '', ...product.variants.map((variant) => variant.barcode ?? '')]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  return (
    <Screen
      title={t('products.title')}
      action={
        managesProducts && shop?.usesBarcodes ? (
          <IconButton
            name="barcode_scanner"
            label={t('products.scanBarcode')}
            onPress={() => router.push('/scan')}
          />
        ) : undefined
      }
      footer={
        managesProducts ? (
          <Button label={t('products.addProduct')} onPress={() => router.push('/product/new')} />
        ) : undefined
      }
    >
      <View style={styles.counts} accessibilityRole="radiogroup">
        <Count
          label={t('products.filter.all')}
          value={counts.all}
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <Count
          label={t('products.filter.low')}
          value={counts.low}
          tone="warning"
          active={filter === 'low'}
          onPress={() => setFilter('low')}
        />
        <Count
          label={t('products.filter.out')}
          value={counts.out}
          tone="danger"
          active={filter === 'out'}
          onPress={() => setFilter('out')}
        />
      </View>

      <View style={styles.search}>
        <Icon name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('products.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('products.searchPlaceholder')}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>

      {error ? <Text style={styles.muted}>{error}</Text> : null}

      {!loading && !error && visible.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="inventory_2" size={40} color={colors.border} />
          <Text style={styles.emptyText}>
            {products.length === 0 ? t('products.emptyShort') : t('products.noMatch')}
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {visible.map((product) => {
          const state = states.get(product.id) ?? 'ok';
          const barcode = product.variants.find((variant) => variant.barcode)?.barcode;
          const meta = [
            product.variants.length > 1
              ? t('products.variantCount', { count: product.variants.length })
              : null,
            product.category,
            barcode,
          ]
            .filter(Boolean)
            .join(' · ');
          const row = (
            <>
              <View style={styles.rowMain}>
                <Text style={styles.name} numberOfLines={1}>
                  {product.name}
                </Text>
                {meta ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </View>
              <View style={styles.rowSide}>
                <Text style={styles.price} numberOfLines={1}>
                  {formatKwacha(product.defaultSellPrice)}
                </Text>
                <Pill
                  label={
                    state === 'out' ? t('products.filter.out') : t('products.left', { count: product.stock })
                  }
                  tone={state === 'out' ? 'danger' : state === 'low' ? 'warning' : 'neutral'}
                />
              </View>
              {managesProducts ? <Icon name="chevron_right" color={colors.textMuted} /> : null}
            </>
          );

          return managesProducts ? (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              onPress={() => router.push(`/product/${product.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              {row}
            </Pressable>
          ) : (
            <View key={product.id} style={styles.row}>
              {row}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

function Count({
  label,
  value,
  tone,
  active,
  onPress,
}: {
  label: string;
  value: number;
  tone?: 'warning' | 'danger';
  active: boolean;
  onPress: () => void;
}) {
  const ink = value > 0 && tone ? (tone === 'danger' ? colors.danger : colors.warning) : colors.text;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[styles.count, active && styles.countActive]}
    >
      <Text style={[styles.countValue, { color: ink }]}>{value}</Text>
      <Text style={styles.countLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', gap: spacing.sm },
  count: {
    flex: 1,
    minHeight: touch.minHeight + spacing.xl,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  countActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  countValue: {
    fontSize: typeScale.title,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    fontSize: typeScale.label,
    color: colors.textMuted,
    fontWeight: '600',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.minHeight,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    flex: 1,
    minHeight: touch.minHeight,
    fontSize: typeScale.body,
    color: colors.text,
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minHeight + spacing.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowMain: { flex: 1, gap: 2 },
  name: { fontSize: typeScale.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: typeScale.label, color: colors.textMuted },
  rowSide: { alignItems: 'flex-end', gap: spacing.xs },
  price: {
    fontSize: typeScale.body,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontSize: typeScale.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
