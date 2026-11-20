import { describe, expect, it } from 'vitest';
import {
  buildInsights,
  change,
  niceTicks,
  periodDays,
  previousPeriodDays,
  type InsightLine,
  type InsightRows,
  type InsightSale,
} from './insights';

// A local noon on a fixed day, so day bucketing does not depend on the
// machine's time zone.
const NOW = new Date(2026, 10, 20, 12, 0, 0);
const at = (daysBack: number, hour: number) =>
  new Date(2026, 10, 20 - daysBack, hour, 15, 0).toISOString();

function sale(id: string, daysBack: number, hour: number, total: number): InsightSale {
  return { id, createdAt: at(daysBack, hour), total };
}

function line(saleId: string, daysBack: number, product: string, quantity: number, buy: number, final: number): InsightLine {
  return {
    saleId,
    createdAt: at(daysBack, 10),
    productId: product,
    productName: product.toUpperCase(),
    quantity,
    buyPrice: buy,
    finalPrice: final,
  };
}

const rows: InsightRows = {
  sales: [
    sale('s1', 0, 9, 10000),
    sale('s2', 0, 17, 5000),
    sale('s3', 3, 17, 20000),
    sale('old', 9, 11, 8000), // previous 7-day window
    sale('ancient', 40, 11, 99999), // outside both
  ],
  lines: [
    line('s1', 0, 'shoe', 1, 6000, 10000),
    line('s2', 0, 'sock', 5, 500, 5000),
    line('s3', 3, 'shoe', 2, 6000, 20000),
    line('old', 9, 'sock', 4, 1000, 8000),
  ],
  payments: [
    { createdAt: at(0, 9), method: 'cash', provider: null, amount: 10000 },
    { createdAt: at(0, 17), method: 'mobile_money', provider: 'Airtel', amount: 5000 },
    { createdAt: at(3, 17), method: 'mobile_money', provider: 'MTN', amount: 20000 },
    { createdAt: at(9, 11), method: 'cash', provider: null, amount: 8000 },
  ],
  stock: [
    { productId: 'shoe', productName: 'SHOE', units: 4, value: 24000 },
    { productId: 'hat', productName: 'HAT', units: 10, value: 30000 },
    { productId: 'gone', productName: 'GONE', units: 0, value: 0 },
  ],
};

describe('periodDays', () => {
  it('lists the period oldest first, ending today', () => {
    const days = periodDays(7, NOW);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-11-14');
    expect(days[6]).toBe('2026-11-20');
  });

  it('gives the window just before for comparison', () => {
    const days = previousPeriodDays(7, NOW);
    expect(days[0]).toBe('2026-11-07');
    expect(days[6]).toBe('2026-11-13');
  });

  it('crosses a month boundary', () => {
    expect(periodDays(30, NOW)[0]).toBe('2026-10-22');
  });
});

describe('buildInsights', () => {
  const insights = buildInsights(rows, 7, NOW);

  it('totals sales, profit, count and average for the period', () => {
    expect(insights.current).toEqual({
      sales: 35000,
      profit: 35000 - (6000 + 2500 + 12000),
      saleCount: 3,
      avgSale: Math.round(35000 / 3),
      margin: (35000 - 20500) / 35000,
    });
  });

  it('totals the previous period on its own', () => {
    expect(insights.previous.sales).toBe(8000);
    expect(insights.previous.profit).toBe(4000);
  });

  it('puts each sale on its local day, with empty days kept', () => {
    expect(insights.daily).toHaveLength(7);
    expect(insights.daily[6]).toMatchObject({ day: '2026-11-20', sales: 15000, profit: 15000 - 8500, saleCount: 2 });
    expect(insights.daily[3]).toMatchObject({ day: '2026-11-17', sales: 20000, saleCount: 1 });
    expect(insights.daily[0]).toMatchObject({ sales: 0, profit: 0, saleCount: 0 });
  });

  it('spreads sales over trading hours, at least 07:00 to 19:00', () => {
    expect(insights.hours[0].hour).toBe(7);
    expect(insights.hours.at(-1)?.hour).toBe(19);
    expect(insights.hours.find((point) => point.hour === 17)).toEqual({ hour: 17, sales: 25000, saleCount: 2 });
    expect(insights.hours.find((point) => point.hour === 8)?.sales).toBe(0);
  });

  it('averages sales per weekday', () => {
    // 2026-11-20 is a Friday (index 4); 2026-11-17 a Tuesday (index 1).
    expect(insights.weekdays[4].sales).toBe(15000);
    expect(insights.weekdays[1].sales).toBe(20000);
    expect(insights.weekdays[0].sales).toBe(0);
  });

  it('ranks products by sales with profit and units', () => {
    expect(insights.products).toEqual([
      { productId: 'shoe', name: 'SHOE', sales: 30000, profit: 12000, units: 3 },
      { productId: 'sock', name: 'SOCK', sales: 5000, profit: 2500, units: 5 },
    ]);
  });

  it('splits payments in a fixed order and drops empty methods', () => {
    expect(insights.payments).toEqual([
      { key: 'cash', amount: 10000 },
      { key: 'MTN', amount: 20000 },
      { key: 'Airtel', amount: 5000 },
    ]);
  });

  it('ranks money on the shelf and shows what sold', () => {
    expect(insights.shelf).toEqual([
      { productId: 'hat', name: 'HAT', value: 30000, units: 10, soldUnits: 0 },
      { productId: 'shoe', name: 'SHOE', value: 24000, units: 4, soldUnits: 3 },
    ]);
  });

  it('handles a shop with no sales yet', () => {
    const empty = buildInsights({ sales: [], lines: [], payments: [], stock: [] }, 30, NOW);
    expect(empty.current).toEqual({ sales: 0, profit: 0, saleCount: 0, avgSale: 0, margin: null });
    expect(empty.daily).toHaveLength(30);
    expect(empty.products).toEqual([]);
    expect(empty.payments).toEqual([]);
  });
});

describe('change', () => {
  it('is a fraction of the previous value', () => {
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(50, 100)).toBeCloseTo(-0.5);
  });

  it('is null with nothing to compare against', () => {
    expect(change(10, 0)).toBeNull();
  });

  it('measures against the size of a negative previous value', () => {
    expect(change(50, -100)).toBeCloseTo(1.5);
  });
});

describe('niceTicks', () => {
  it('uses round steps that cover the maximum', () => {
    expect(niceTicks(950)).toEqual([0, 500, 1000]);
    expect(niceTicks(3200)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(niceTicks(0)).toEqual([0]);
  });
});
