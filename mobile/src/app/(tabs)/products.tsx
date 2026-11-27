import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { RestockSheet } from '@/components/stock/restock-sheet';
import { StockCard } from '@/components/stock/stock-card';
import {
  Button,
  Choice,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingList,
  Screen,
  SearchField,
  StatTile,
} from '@/components/ui';
import { expiryStatus, profileForShop, todayLocal } from '@/core';
import { useProducts, useShop } from '@/db/hooks';
import type { ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { colors, fonts, spacing, themed, typeScale } from '@/theme/tokens';

type Filter = 'all' | 'low' | 'out' | 'expiring';

/** Has stock on hand that is past its expiry or within the warning window. */
function isExpiring(product: ProductWithStock, today: string): boolean {
  return product.variants.some((variant) => {
    const status = expiryStatus(variant.expiryDate, today);
    return variant.quantity > 0 && (status === 'expired' || status === 'soon');
  });
}

// Out first, then low: what needs restocking is at the top.
const STATE_ORDER = { out: 0, low: 1, ok: 2 } as const;

function worstState(product: ProductWithStock): 'ok' | 'low' | 'out' {
  return product.variants.reduce<'ok' | 'low' | 'out'>((worst, variant) => {
    if (variant.state === 'out') return 'out';
    if (variant.state === 'low' && worst === 'ok') return 'low';
    return worst;
  }, 'ok');
}

/**
 * The stock list. Three counts at the top double as filters, so "what is
 * running out?" is one tap. Each product is a card; owners tap one to add stock.
 */
export default function ProductsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const { data: products, initialLoading, error, reload } = useProducts();
  const { data: shop } = useShop();
  const [query, setQuery] = useState('');
  // Home's "N more" opens the list already narrowed to what it was about.
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();
  const asFilter = (value?: string): Filter =>
    value === 'low' || value === 'out' || value === 'expiring' ? value : 'all';
  const [filter, setFilter] = useState<Filter>(asFilter(initialFilter));
  // The tab stays mounted, so a later "See stock" from Home must still apply.
  const [seenFilter, setSeenFilter] = useState(initialFilter);
  if (initialFilter !== seenFilter) {
    setSeenFilter(initialFilter);
    if (initialFilter) setFilter(asFilter(initialFilter));
  }
  // null = every category.
  const [category, setCategory] = useState<string | null>(null);
  const [restocking, setRestocking] = useState<ProductWithStock | null>(null);

  const profile = profileForShop(shop);
  const showsExpiry = profile.modules.includes('expiry');
  const today = todayLocal();
  const managesProducts = can('products.manage');
  const states = new Map(products.map((product) => [product.id, worstState(product)]));
  const expiring = new Set(products.filter((product) => isExpiring(product, today)).map((product) => product.id));
  const counts = {
    all: products.length,
    low: products.filter((product) => states.get(product.id) === 'low').length,
    out: products.filter((product) => states.get(product.id) === 'out').length,
    expiring: expiring.size,
  };
  const categories = [...new Set(products.map((product) => product.category?.trim()).filter((name): name is string => !!name))].sort(
    (a, b) => a.localeCompare(b)
  );

  const needle = query.trim().toLowerCase();
  const visible = products.filter((product) => {
    if (filter === 'expiring' ? !expiring.has(product.id) : filter !== 'all' && states.get(product.id) !== filter) {
      return false;
    }
    if (category && product.category?.trim() !== category) return false;
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
        {showsExpiry ? (
          <StatTile
            label={t('products.filter.expiring')}
            value={counts.expiring}
            icon="event"
            tone={counts.expiring > 0 ? 'warning' : 'neutral'}
            selected={filter === 'expiring'}
            onPress={() => setFilter('expiring')}
          />
        ) : null}
      </View>

      {managesProducts ? <Text style={styles.ask}>{t('stock.ask')}</Text> : null}

      {categories.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          <Choice label={t('products.category.all')} selected={category === null} onPress={() => setCategory(null)} />
          {categories.map((name) => (
            <Choice
              key={name}
              label={name}
              selected={category === name}
              onPress={() => setCategory((current) => (current === name ? null : name))}
            />
          ))}
        </ScrollView>
      ) : null}

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
          <EmptyState
            icon="inventory_2"
            message={t('products.noMatch')}
            secondary={{
              label: t('products.showAll'),
              icon: 'apps',
              onPress: () => {
                setFilter('all');
                setCategory(null);
              },
            }}
          />
        )
      ) : null}

      {visible.length > 0 ? (
        <View style={styles.grid}>
          {[...visible]
            .sort(
              (a, b) =>
                STATE_ORDER[states.get(a.id) ?? 'ok'] - STATE_ORDER[states.get(b.id) ?? 'ok'] ||
                a.name.localeCompare(b.name)
            )
            .map((product) => (
              <StockCard
                key={product.id}
                product={product}
                state={states.get(product.id) ?? 'ok'}
                onPress={managesProducts ? () => setRestocking(product) : undefined}
              />
            ))}
        </View>
      ) : null}

      <RestockSheet product={restocking} onClose={() => setRestocking(null)} onSaved={reload} />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  counts: { flexDirection: 'row', gap: spacing.sm },
  categories: { flexDirection: 'row', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ask: { fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
}));
