import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { buildInsights, localDayBounds, previousPeriodDays, type InsightPeriod, type Insights } from '@/core';
import { todayLocal } from '@/core';
import {
  getSaleDetail,
  getShop,
  getTaxPotView,
  insightRows,
  listMovements,
  listProductsWithStock,
  listSales,
  listStaff,
  lowStockVariants,
  reconcileDay,
  taxSnapshot,
  totalsForDay,
  type LowStockRow,
  type MovementRow,
  type ProductWithStock,
  type ReconcileDayResult,
  type SaleDetail,
  type SaleSummary,
  type ShopRecord,
  type StaffRecord,
  type TaxPotView,
  type TaxSnapshot,
} from './repos';

/**
 * Screen-level read hooks. They refresh on focus, so recording a sale on one
 * screen updates Home and Sales when you navigate back, without a global store.
 */
function useQuery<T>(
  initial: T,
  run: (db: ReturnType<typeof useSQLiteContext>) => Promise<T>,
  deps: readonly unknown[] = []
) {
  const db = useSQLiteContext();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // A literal dependency list keeps the lint rule happy; the key encodes the
  // caller's own dependencies (for example a sale id).
  const depKey = deps.map((value) => String(value)).join('|');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      run(db)
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not read the database');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
      // `run` is a fresh closure each render; tick and depKey are the reload keys.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, tick, depKey])
  );

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, reload };
}

export function useProducts() {
  return useQuery<ProductWithStock[]>([], (db) => listProductsWithStock(db));
}

export function useShop() {
  return useQuery<ShopRecord | null>(null, (db) => getShop(db));
}

export function useSales() {
  return useQuery<SaleSummary[]>([], (db) => listSales(db));
}

export function useStaff() {
  return useQuery<StaffRecord[]>([], (db) => listStaff(db));
}

export function useSaleDetail(saleId: string) {
  return useQuery<SaleDetail | null>(null, (db) => getSaleDetail(db, saleId), [saleId]);
}

export function useMovements(variantId: string) {
  return useQuery<MovementRow[]>([], (db) => (variantId ? listMovements(db, variantId) : Promise.resolve([])), [
    variantId,
  ]);
}

export function useDayTotals() {
  return useQuery(
    { salesTotal: 0, saleCount: 0, discounts: 0, cost: 0, grossProfit: 0 },
    (db) => totalsForDay(db, todayLocal())
  );
}

export function useLowStock() {
  return useQuery<LowStockRow[]>([], (db) => lowStockVariants(db));
}

export function useTaxSnapshot() {
  return useQuery<TaxSnapshot>(
    { turnover: 0, yearToDate: 0, potBalance: 0, period: null, unresolvedSales: 0 },
    (db) => taxSnapshot(db)
  );
}

export function useTaxPot() {
  return useQuery<TaxPotView>(
    { turnover: 0, yearToDate: 0, potBalance: 0, period: null, unresolvedSales: 0, entries: [] },
    (db) => getTaxPotView(db)
  );
}

/**
 * Matching is idempotent, so it is safe to run every time the screen gains
 * focus: previously resolved items keep their state, and new payments appear.
 */
export function useReconciliation() {
  return useQuery<ReconcileDayResult | null>(null, (db) => reconcileDay(db));
}

/** Owner insights for the last 7 or 30 days, compared with the period before. */
export function useInsights(period: InsightPeriod) {
  return useQuery<Insights | null>(
    null,
    async (db) => {
      const now = new Date();
      const [since] = localDayBounds(previousPeriodDays(period, now)[0]);
      return buildInsights(await insightRows(db, since), period, now);
    },
    [period]
  );
}
