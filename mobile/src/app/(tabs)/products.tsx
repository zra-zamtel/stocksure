import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  LoadingList,
  Pill,
  Screen,
  SearchField,
  StatTile,
} from '@/components/ui';
import { useProducts, useShop } from '@/db/hooks';
import type { ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { colors, fonts, spacing, themed, typeScale } from '@/theme/tokens';

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
  const { data: products, initialLoading, error, reload } = useProducts();
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
    return [
      product.name,
      product.category ?? '',
      ...product.variants.map((variant) => variant.barcode ?? ''),
      ...product.variants.flatMap((variant) => variant.attributes.map((attribute) => attribute.value)),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  const scan = () => router.push('/scan');
  const addProduct = () => router.push('/product/new');

  if (initialLoading || error || products.length === 0) {
    return (
      <Screen title={t('products.title')}>
        {initialLoading ? (
          <LoadingList label={t('state.loading')} count={4} />
        ) : error ? (
          <ErrorState
            title={t('state.error.title')}
            message={t('state.error.message')}
            detail={error}
            retryLabel={t('common.retry')}
            onRetry={reload}
          />
        ) : (
          <EmptyState
            icon="inventory_2"
            title={t('products.empty.title')}
            message={t(managesProducts ? 'products.empty.message' : 'products.empty.staffMessage')}
            action={
              managesProducts ? { label: t('products.addProduct'), icon: 'add', onPress: addProduct } : undefined
            }
            secondary={
              managesProducts && shop?.usesBarcodes
                ? { label: t('products.empty.scan'), icon: 'barcode_scanner', onPress: scan }
                : undefined
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title={t('products.title')}
      action={
        managesProducts && shop?.usesBarcodes ? (
          <IconButton
            name="barcode_scanner"
            label={t('products.scanBarcode')}
            onPress={scan}
          />
        ) : undefined
      }
      footer={
        managesProducts ? (
          <Button label={t('products.addProduct')} icon="add" onPress={addProduct} />
        ) : undefined
      }
    >
      <View style={styles.counts} accessibilityRole="radiogroup">
        <StatTile
          label={t('products.filter.all')}
          value={counts.all}
          icon="inventory_2"
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <StatTile
          label={t('products.filter.low')}
          value={counts.low}
          icon="trending_down"
          tone={counts.low > 0 ? 'warning' : 'neutral'}
          selected={filter === 'low'}
          onPress={() => setFilter('low')}
        />
        <StatTile
          label={t('products.filter.out')}
          value={counts.out}
          icon="remove_shopping_cart"
          tone={counts.out > 0 ? 'danger' : 'neutral'}
          selected={filter === 'out'}
          onPress={() => setFilter('out')}
        />
      </View>

      <SearchField
        value={query}
        onChangeText={setQuery}
        label={t('products.searchPlaceholder')}
        clearLabel={t('common.clearSearch')}
      />

      {visible.length === 0 ? (
        needle ? (
          <EmptyState
            icon="search_off"
            title={t('products.noMatch.title', { query: query.trim() })}
            message={t('products.noMatch.message')}
            secondary={{ label: t('products.noMatch.clear'), icon: 'close', onPress: () => setQuery('') }}
          />
        ) : (
          <View style={styles.empty}>
            <Icon name="inventory_2" size={40} color={colors.border} />
            <Text style={styles.emptyText}>{t('products.noMatch')}</Text>
          </View>
        )
      ) : null}

      {visible.length > 0 ? (
        <ListGroup>
          {visible.map((product, index) => {
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
            // One scheme everywhere: red = out, amber = low (at or under the
            // product's own low-stock level), no colour = fine.
            const stockLabel =
              state === 'out'
                ? t('products.filter.out')
                : state === 'low'
                  ? t('products.lowLeft', { count: product.stock })
                  : t('products.stockCount', { count: product.stock });
            return (
              <ListRow
                key={product.id}
                last={index === visible.length - 1}
                title={product.name}
                meta={meta || null}
                right={
                  <>
                    <Text style={styles.price} numberOfLines={1}>
                      {formatKwacha(product.defaultSellPrice)}
                    </Text>
                    {state === 'ok' ? (
                      <Text style={styles.stock} numberOfLines={1}>
                        {stockLabel}
                      </Text>
                    ) : (
                      <Pill label={stockLabel} tone={state === 'out' ? 'danger' : 'warning'} />
                    )}
                  </>
                }
                accessibilityLabel={`${product.name}, ${formatKwacha(product.defaultSellPrice)}, ${stockLabel}`}
                onPress={managesProducts ? () => router.push(`/product/${product.id}`) : undefined}
              />
            );
          })}
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  counts: { flexDirection: 'row', gap: spacing.sm },
  stock: { fontSize: typeScale.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  price: {
    fontFamily: fonts.display,
    fontSize: typeScale.body,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
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
}));
