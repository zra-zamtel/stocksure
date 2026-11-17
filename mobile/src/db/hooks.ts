import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import {
  listProductsWithStock,
  listSales,
  lowStockVariants,
  taxSnapshot,
  totalsForDay,
  type LowStockRow,
  type ProductWithStock,
  type SaleSummary,
  type TaxSnapshot,
} from './repos';

function todayLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

interface QueryState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useQuery<T>(initial: T, run: (db: ReturnType<typeof useSQLiteContext>) => Promise<T>): QueryState<T> {
  const db = useSQLiteContext();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
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
    // `run` is a fresh closure each render; the tick is the explicit reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, reload };
}

export function useProducts() {
  return useQuery<ProductWithStock[]>([], (db) => listProductsWithStock(db));
}

export function useSales() {
  return useQuery<SaleSummary[]>([], (db) => listSales(db));
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
  return useQuery<TaxSnapshot>({ turnover: 0, potBalance: 0 }, (db) => taxSnapshot(db));
}
