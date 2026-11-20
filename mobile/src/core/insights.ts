import { todayLocal } from './ids';
import type { Ngwee } from './types';

/**
 * Owner insights: the numbers behind the Insights screen, worked out from raw
 * rows so the maths is testable without a database. Everything is in ngwee and
 * bucketed by the phone's local day and hour, the shop's own clock.
 */

export type InsightPeriod = 7 | 30;

export interface InsightSale {
  id: string;
  createdAt: string;
  total: Ngwee;
}

export interface InsightLine {
  saleId: string;
  createdAt: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Per unit, frozen at the time of sale. */
  buyPrice: Ngwee;
  /** Whole line after discount. */
  finalPrice: Ngwee;
}

export interface InsightPayment {
  createdAt: string;
  method: 'cash' | 'mobile_money';
  provider: string | null;
  amount: Ngwee;
}

export interface InsightStock {
  productId: string;
  productName: string;
  units: number;
  /** Units on hand times buy price: money sitting on the shelf. */
  value: Ngwee;
}

export interface InsightRows {
  sales: InsightSale[];
  lines: InsightLine[];
  payments: InsightPayment[];
  stock: InsightStock[];
}

export interface PeriodTotals {
  sales: Ngwee;
  profit: Ngwee;
  saleCount: number;
  avgSale: Ngwee;
  /** Profit as a share of sales, 0 to 1; null with no sales. */
  margin: number | null;
}

export interface DayPoint {
  day: string;
  sales: Ngwee;
  profit: Ngwee;
  saleCount: number;
}

export interface HourPoint {
  hour: number;
  sales: Ngwee;
  saleCount: number;
}

export interface WeekdayPoint {
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  /** Average per occurrence of that weekday in the period. */
  sales: Ngwee;
}

export interface ProductPoint {
  productId: string;
  name: string;
  sales: Ngwee;
  profit: Ngwee;
  units: number;
}

export type PaymentKey = 'cash' | 'MTN' | 'Airtel' | 'Zamtel' | 'mobile';

export interface PaymentPoint {
  key: PaymentKey;
  amount: Ngwee;
}

export interface ShelfPoint {
  productId: string;
  name: string;
  value: Ngwee;
  units: number;
  soldUnits: number;
}

export interface Insights {
  period: InsightPeriod;
  days: string[];
  current: PeriodTotals;
  previous: PeriodTotals;
  daily: DayPoint[];
  hours: HourPoint[];
  weekdays: WeekdayPoint[];
  products: ProductPoint[];
  payments: PaymentPoint[];
  shelf: ShelfPoint[];
}

const PAYMENT_ORDER: PaymentKey[] = ['cash', 'MTN', 'Airtel', 'Zamtel', 'mobile'];

/** The local days of a period ending today, oldest first. */
export function periodDays(period: InsightPeriod, now: Date = new Date()): string[] {
  const days: string[] = [];
  for (let back = period - 1; back >= 0; back -= 1) {
    days.push(todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12)));
  }
  return days;
}

/** The local days of the period just before, for comparison. */
export function previousPeriodDays(period: InsightPeriod, now: Date = new Date()): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - period, 12);
  return periodDays(period, start);
}

const dayOf = (iso: string) => todayLocal(new Date(iso));

function totalsFor(sales: InsightSale[], lines: InsightLine[]): PeriodTotals {
  const total = sales.reduce((sum, sale) => sum + sale.total, 0);
  const cost = lines.reduce((sum, line) => sum + line.buyPrice * line.quantity, 0);
  const profit = total - cost;
  return {
    sales: total,
    profit,
    saleCount: sales.length,
    avgSale: sales.length > 0 ? Math.round(total / sales.length) : 0,
    margin: total > 0 ? profit / total : null,
  };
}

/**
 * Change from the previous period as a fraction (0.12 = up 12%). Null when
 * there is nothing to compare against, so the screen says "new" instead of
 * an infinite percentage.
 */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function buildInsights(rows: InsightRows, period: InsightPeriod, now: Date = new Date()): Insights {
  const days = periodDays(period, now);
  const inCurrent = new Set(days);
  const inPrevious = new Set(previousPeriodDays(period, now));

  const currentSales = rows.sales.filter((sale) => inCurrent.has(dayOf(sale.createdAt)));
  const previousSales = rows.sales.filter((sale) => inPrevious.has(dayOf(sale.createdAt)));
  const currentLines = rows.lines.filter((line) => inCurrent.has(dayOf(line.createdAt)));
  const previousLines = rows.lines.filter((line) => inPrevious.has(dayOf(line.createdAt)));

  // Daily sales and profit.
  const byDay = new Map(days.map((day) => [day, { day, sales: 0, profit: 0, saleCount: 0 }]));
  for (const sale of currentSales) {
    const point = byDay.get(dayOf(sale.createdAt));
    if (!point) continue;
    point.sales += sale.total;
    point.profit += sale.total;
    point.saleCount += 1;
  }
  for (const line of currentLines) {
    const point = byDay.get(dayOf(line.createdAt));
    if (point) point.profit -= line.buyPrice * line.quantity;
  }

  // Hour of day: the shop's trading hours, widened to at least 07:00-19:00.
  const byHour = new Map<number, HourPoint>();
  for (const sale of currentSales) {
    const hour = new Date(sale.createdAt).getHours();
    const point = byHour.get(hour) ?? { hour, sales: 0, saleCount: 0 };
    point.sales += sale.total;
    point.saleCount += 1;
    byHour.set(hour, point);
  }
  const seen = [...byHour.keys()];
  const firstHour = Math.min(7, ...seen);
  const lastHour = Math.max(19, ...seen);
  const hours: HourPoint[] = [];
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    hours.push(byHour.get(hour) ?? { hour, sales: 0, saleCount: 0 });
  }

  // Average sales per weekday, Monday first.
  const weekdayTotals = Array.from({ length: 7 }, () => 0);
  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number);
    const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
    weekdayCounts[weekday] += 1;
    weekdayTotals[weekday] += byDay.get(day)?.sales ?? 0;
  }
  const weekdays = weekdayTotals.map((total, weekday) => ({
    weekday,
    sales: weekdayCounts[weekday] > 0 ? Math.round(total / weekdayCounts[weekday]) : 0,
  }));

  // Products by sales, profit and units.
  const byProduct = new Map<string, ProductPoint>();
  for (const line of currentLines) {
    const point = byProduct.get(line.productId) ?? {
      productId: line.productId,
      name: line.productName,
      sales: 0,
      profit: 0,
      units: 0,
    };
    point.sales += line.finalPrice;
    point.profit += line.finalPrice - line.buyPrice * line.quantity;
    point.units += line.quantity;
    byProduct.set(line.productId, point);
  }
  const products = [...byProduct.values()].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));

  // How customers paid, in a fixed order so a colour always means one method.
  const paid = new Map<PaymentKey, number>();
  for (const payment of rows.payments) {
    if (!inCurrent.has(dayOf(payment.createdAt))) continue;
    const key: PaymentKey =
      payment.method === 'cash'
        ? 'cash'
        : payment.provider === 'MTN' || payment.provider === 'Airtel' || payment.provider === 'Zamtel'
          ? payment.provider
          : 'mobile';
    paid.set(key, (paid.get(key) ?? 0) + payment.amount);
  }
  const payments = PAYMENT_ORDER.filter((key) => (paid.get(key) ?? 0) > 0).map((key) => ({
    key,
    amount: paid.get(key) ?? 0,
  }));

  // Money on the shelf, with what sold in the period beside it.
  const soldUnits = new Map<string, number>();
  for (const line of currentLines) soldUnits.set(line.productId, (soldUnits.get(line.productId) ?? 0) + line.quantity);
  const shelf = rows.stock
    .filter((item) => item.units > 0 && item.value > 0)
    .map((item) => ({
      productId: item.productId,
      name: item.productName,
      value: item.value,
      units: item.units,
      soldUnits: soldUnits.get(item.productId) ?? 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  return {
    period,
    days,
    current: totalsFor(currentSales, currentLines),
    previous: totalsFor(previousSales, previousLines),
    daily: days.map((day) => byDay.get(day)!),
    hours,
    weekdays,
    products,
    payments,
    shelf,
  };
}

/** Clean axis steps (1, 2 or 5 times a power of ten) covering the maximum. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) {
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}
