import { describe, expect, it } from 'vitest';
import { percentOf, toNgwee } from './money';
import { priceLine, priceSale, validatePayments } from './pricing';
import { cashVariance, matchPayments } from './reconcile';
import { needsOverride, quantityOnHand, reversalFor, stockState, validateRestock } from './stock';
import { localDayBounds } from './ids';
import {
  encodeEan13,
  ean13CheckDigit,
  generateInStoreBarcode,
  isInStoreBarcode,
  isValidEan13,
  normaliseBarcode,
} from './barcode';
import { autoSetAside, dueDateFor, estimateTurnoverTax, potStatus, reminderDates } from './tax';
import type { StockMovement, TaxRules } from './types';

const rules: TaxRules = {
  version: 1,
  rate: 0.04,
  threshold: toNgwee(800_000),
  periodDays: 30,
  dueDaysAfterPeriod: 14,
  reminderDaysBefore: [7, 3, 0],
};

describe('money', () => {
  it('converts kwacha to integer ngwee', () => {
    expect(toNgwee(280)).toBe(28000);
    expect(toNgwee(0.1 + 0.2)).toBe(30);
  });

  it('rounds percentages to whole ngwee', () => {
    expect(percentOf(28000, 10)).toBe(2800);
    expect(percentOf(333, 10)).toBe(33);
  });
});

describe('pricing a line', () => {
  const base = { variantId: 'v1', quantity: 1, buyPrice: 18000, sellPrice: 28000 };

  it('applies an active product discount', () => {
    const line = priceLine({
      ...base,
      productDiscount: { enabled: true, type: 'percent', value: 10 },
    });
    expect(line.listPrice).toBe(28000);
    expect(line.discount).toBe(2800);
    expect(line.finalPrice).toBe(25200);
    expect(line.belowCost).toBe(false);
  });

  it('ignores a discount outside its date window', () => {
    const line = priceLine(
      {
        ...base,
        productDiscount: {
          enabled: true,
          type: 'percent',
          value: 10,
          startsAt: '2026-12-01T00:00:00Z',
        },
      },
      new Date('2026-11-17T10:00:00Z')
    );
    expect(line.discount).toBe(0);
    expect(line.finalPrice).toBe(28000);
  });

  it('warns instead of blocking when a discount goes below cost', () => {
    const line = priceLine({ ...base, lineDiscount: 12000 });
    expect(line.finalPrice).toBe(16000);
    expect(line.profit).toBe(-2000);
    expect(line.belowCost).toBe(true);
  });

  it('never discounts below zero', () => {
    const line = priceLine({ ...base, lineDiscount: 999999 });
    expect(line.finalPrice).toBe(0);
    expect(line.discount).toBe(28000);
  });

  it('multiplies quantity before discounting', () => {
    const line = priceLine({
      variantId: 'v1',
      quantity: 3,
      buyPrice: 18000,
      sellPrice: 28000,
      productDiscount: { enabled: true, type: 'percent', value: 10 },
    });
    expect(line.listPrice).toBe(84000);
    expect(line.discount).toBe(8400);
    expect(line.finalPrice).toBe(75600);
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => priceLine({ ...base, quantity: 0 })).toThrow();
  });
});

describe('pricing a sale', () => {
  it('totals lines, discounts, cost and profit', () => {
    const sale = priceSale([
      { variantId: 'v1', quantity: 1, buyPrice: 18000, sellPrice: 28000 },
      { variantId: 'v2', quantity: 2, buyPrice: 2500, sellPrice: 6000 },
    ]);
    expect(sale.subtotal).toBe(40000);
    expect(sale.total).toBe(40000);
    expect(sale.costTotal).toBe(23000);
    expect(sale.profit).toBe(17000);
    expect(sale.belowCostLines).toHaveLength(0);
  });
});

describe('payments', () => {
  it('accepts a split that adds up', () => {
    expect(
      validatePayments(30000, [
        { method: 'cash', amount: 10000 },
        { method: 'mobile_money', amount: 20000, provider: 'MTN', reference: 'MP1' },
      ])
    ).toEqual([]);
  });

  it('rejects a split that does not add up', () => {
    expect(validatePayments(30000, [{ method: 'cash', amount: 10000 }])).toHaveLength(1);
  });

  it('rejects mobile money without a reference, which could never reconcile', () => {
    const errors = validatePayments(10000, [
      { method: 'mobile_money', amount: 10000, provider: 'Airtel' },
    ]);
    expect(errors.some((error) => error.includes('reference'))).toBe(true);
  });
});

describe('stock', () => {
  const movements = [
    { variantId: 'v1', quantityChange: 6 },
    { variantId: 'v1', quantityChange: -2 },
    { variantId: 'v2', quantityChange: 4 },
  ] as Pick<StockMovement, 'variantId' | 'quantityChange'>[];

  it('derives quantity from movements only', () => {
    expect(quantityOnHand(movements, 'v1')).toBe(4);
    expect(quantityOnHand(movements, 'v2')).toBe(4);
  });

  it('treats the low-stock level as inclusive', () => {
    expect(stockState(0, 3)).toBe('out');
    expect(stockState(3, 3)).toBe('low');
    expect(stockState(4, 3)).toBe('ok');
  });

  it('asks for an override only when selling past zero', () => {
    expect(needsOverride(2, 2)).toBe(false);
    expect(needsOverride(2, 3)).toBe(true);
  });

  it('rejects a restock quantity that is fractional or not positive', () => {
    expect(validateRestock(3)).toEqual([]);
    expect(validateRestock(1.5)).toHaveLength(1);
    expect(validateRestock(0)).toHaveLength(1);
    expect(validateRestock(-2)).toHaveLength(1);
  });

  it('rejects a negative buy price but allows zero', () => {
    expect(validateRestock(2, 18000)).toEqual([]);
    expect(validateRestock(2, 0)).toEqual([]);
    expect(validateRestock(2, -1)).toHaveLength(1);
  });
});

describe('barcodes', () => {
  it('computes the EAN-13 check digit', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
  });

  it('accepts a valid code and rejects a wrong check digit', () => {
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('5901234123458')).toBe(false);
    expect(isValidEan13('not-a-code')).toBe(false);
  });

  it('encodes 95 modules with the EAN-13 guards', () => {
    const bits = encodeEan13('5901234123457');
    expect(bits).toHaveLength(95);
    expect(bits.startsWith('101')).toBe(true);
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.endsWith('101')).toBe(true);
    expect(/^[01]+$/.test(bits)).toBe(true);
  });

  it('refuses to encode an invalid code', () => {
    expect(() => encodeEan13('5901234123458')).toThrow();
  });

  it('generates in-store codes that are valid and in the GS1 2 range', () => {
    let seed = 0.42;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280 / 233280;
      return seed;
    };
    const code = generateInStoreBarcode(random);
    expect(code).toHaveLength(13);
    expect(code.startsWith('2')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
    expect(isInStoreBarcode(code)).toBe(true);
  });

  it('treats a 12-digit UPC-A as the same product as its EAN-13 form', () => {
    expect(normaliseBarcode('012345678905')).toBe('0012345678905');
    expect(normaliseBarcode(' 5901234123457 ')).toBe('5901234123457');
  });
});

describe('turnover tax', () => {
  it('estimates below the threshold', () => {
    const estimate = estimateTurnoverTax(toNgwee(5000), rules);
    expect(estimate.eligible).toBe(true);
    expect(estimate.estimatedTax).toBe(20000);
  });

  it('refuses to guess above the threshold', () => {
    const estimate = estimateTurnoverTax(rules.threshold + 1, rules);
    expect(estimate.eligible).toBe(false);
    expect(estimate.estimatedTax).toBe(0);
  });

  it('is zero with no sales', () => {
    expect(estimateTurnoverTax(0, rules).eligible).toBe(false);
  });

  it('reports covered, short and over', () => {
    expect(potStatus(20000, 20000)).toEqual({ state: 'covered', difference: 0 });
    expect(potStatus(20000, 5000)).toEqual({ state: 'short', difference: 15000 });
    expect(potStatus(20000, 25000)).toEqual({ state: 'over', difference: -5000 });
  });

  it('derives the due date and reminder dates from the rules file', () => {
    expect(dueDateFor('2026-11-30', rules)).toBe('2026-12-14');
    expect(reminderDates('2026-12-14', rules)).toEqual(['2026-12-07', '2026-12-11', '2026-12-14']);
  });

  it('sets aside without overstating cover', () => {
    expect(autoSetAside(25200, rules)).toBe(1008);
    expect(autoSetAside(2499, rules)).toBe(99);
  });
});

describe('reconciliation matching', () => {
  const sale = {
    id: 's1',
    amount: 25200,
    reference: 'MP2607.1122.A84721',
    at: '2026-11-17T09:15:00+02:00',
  };

  it('matches on amount, reference and a close time', () => {
    const result = matchPayments([sale], [{ ...sale, id: 'r1', at: '2026-11-17T09:20:00+02:00' }], 30);
    expect(result.matched).toEqual([{ saleId: 's1', receivedId: 'r1' }]);
    expect(result.unmatchedSales).toEqual([]);
  });

  it('refuses a match outside the time window', () => {
    const result = matchPayments([sale], [{ ...sale, id: 'r1', at: '2026-11-17T12:15:00+02:00' }], 30);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSales).toEqual(['s1']);
  });

  it('refuses a match when the reference differs', () => {
    const result = matchPayments([sale], [{ ...sale, id: 'r1', reference: 'OTHER' }], 30);
    expect(result.matched).toHaveLength(0);
  });

  it('matches one to one, leaving the extra payment unmatched', () => {
    const twin = { ...sale, id: 's2' };
    const result = matchPayments(
      [sale, twin],
      [
        { ...sale, id: 'r1' },
        { ...sale, id: 'r2' },
      ],
      30
    );
    expect(result.matched).toHaveLength(2);
    expect(new Set(result.matched.map((match) => match.receivedId)).size).toBe(2);
  });

  it('reports cash variance against the float plus cash sales', () => {
    expect(cashVariance(50000, 12000, 65000)).toEqual({ expected: 62000, variance: 3000 });
  });
});

describe('review fixes', () => {
  it('applies a fixed product discount per unit', () => {
    const line = priceLine({
      variantId: 'v1',
      quantity: 3,
      buyPrice: 18000,
      sellPrice: 28000,
      productDiscount: { enabled: true, type: 'fixed', value: 500 },
    });
    expect(line.discount).toBe(1500);
  });

  it('bounds a local day by local midnights', () => {
    const [start, end] = localDayBounds('2026-11-17');
    expect(new Date(start).getTime()).toBe(new Date(2026, 10, 17).getTime());
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('gives a void the stamp and note it is made with', () => {
    const [reversal] = reversalFor(
      [{ id: 'mv1', variantId: 'v1', quantityChange: -2, reason: 'sale', saleId: 's1', createdAt: 'a', updatedAt: 'a' }],
      's1',
      'b',
      'wrong item'
    );
    expect(reversal).toMatchObject({ id: 'void-mv1', quantityChange: 2, createdAt: 'b', note: 'wrong item' });
  });
});
