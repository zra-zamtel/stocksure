import { describe, expect, it } from 'vitest';
import {
  clampDiscount,
  discountAmount,
  isDiscountActive,
  roundNgwee,
  toKwacha,
  toNgwee,
} from './money';
import { priceLine, priceSale, validatePayments } from './pricing';
import { applyMovement, isLowStock, quantityOnHand, reversalFor, stockState } from './stock';
import { cashVariance, matchPayments, normaliseReference } from './reconcile';
import {
  autoSetAside,
  estimateTurnoverTax,
  potStatus,
  reminderDates,
  taxPeriodForMonth,
} from './tax';
import { localDayBounds, newId, todayLocal } from './ids';
import {
  encodeEan13,
  ean13CheckDigit,
  generateInStoreBarcode,
  isInStoreBarcode,
  isValidEan13,
  normaliseBarcode,
} from './barcode';
import type { StockMovement, TaxRules } from './types';
import { taxRules as shippedTaxRules } from '../data/fake';

/**
 * Unit tests: one function at a time, no database, no screens. These cover the
 * boundaries and error paths that core.test.ts leaves out.
 */

const rules: TaxRules = {
  version: 1,
  rate: 0.04,
  threshold: toNgwee(800_000),
  thresholdBasis: 'period',
  periodDays: 30,
  dueDaysAfterPeriod: 14,
  reminderDaysBefore: [7, 3, 0],
};

describe('UT-MONEY money helpers', () => {
  it('UT-MONEY-01 round-trips kwacha and ngwee without float drift', () => {
    expect(toNgwee(0.1 + 0.2)).toBe(30);
    expect(toNgwee(19.99)).toBe(1999);
    expect(toKwacha(1999)).toBe(19.99);
  });

  it('UT-MONEY-02 rounds half away from zero on both signs', () => {
    expect(roundNgwee(2.5)).toBe(3);
    expect(roundNgwee(-2.5)).toBe(-3);
    expect(roundNgwee(2.4)).toBe(2);
  });

  it('UT-MONEY-03 clamps a discount between zero and the list price', () => {
    expect(clampDiscount(-50, 1000)).toBe(0);
    expect(clampDiscount(1500, 1000)).toBe(1000);
    expect(clampDiscount(300, 1000)).toBe(300);
  });

  it('UT-MONEY-04 ignores a zero or negative discount value', () => {
    expect(discountAmount(1000, 'percent', 0)).toBe(0);
    expect(discountAmount(1000, 'fixed', -10)).toBe(0);
  });

  it('UT-MONEY-05 never discounts more than 100 percent', () => {
    expect(discountAmount(1000, 'percent', 150)).toBe(1000);
  });

  it('UT-MONEY-06 treats discount start and end dates as inclusive', () => {
    const discount = {
      enabled: true,
      type: 'percent' as const,
      value: 10,
      startsAt: '2026-11-01T00:00:00Z',
      endsAt: '2026-11-30T23:59:59Z',
    };
    expect(isDiscountActive(discount, new Date('2026-11-01T00:00:00Z'))).toBe(true);
    expect(isDiscountActive(discount, new Date('2026-11-30T23:59:59Z'))).toBe(true);
    expect(isDiscountActive(discount, new Date('2026-10-31T23:59:59Z'))).toBe(false);
    expect(isDiscountActive(discount, new Date('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('UT-MONEY-07 never applies a disabled or missing discount', () => {
    expect(isDiscountActive(undefined, new Date())).toBe(false);
    expect(isDiscountActive({ enabled: false, type: 'percent', value: 50 }, new Date())).toBe(false);
  });
});

describe('UT-PRICE pricing', () => {
  const at = new Date('2026-11-17T10:00:00Z');

  it('UT-PRICE-01 adds a counter discount on top of the product discount', () => {
    const line = priceLine(
      {
        variantId: 'v1',
        quantity: 2,
        buyPrice: 5000,
        sellPrice: 10000,
        productDiscount: { enabled: true, type: 'percent', value: 10 },
        lineDiscount: 1000,
      },
      at
    );
    expect(line.listPrice).toBe(20000);
    expect(line.discount).toBe(3000);
    expect(line.finalPrice).toBe(17000);
    expect(line.unitPrice).toBe(8500);
  });

  it('UT-PRICE-02 caps a counter discount at what is left after the product discount', () => {
    const line = priceLine(
      {
        variantId: 'v1',
        quantity: 1,
        buyPrice: 0,
        sellPrice: 10000,
        productDiscount: { enabled: true, type: 'percent', value: 50 },
        lineDiscount: 9000,
      },
      at
    );
    expect(line.finalPrice).toBe(0);
    expect(line.discount).toBe(10000);
  });

  it('UT-PRICE-03 rejects negative prices', () => {
    expect(() => priceLine({ variantId: 'v1', quantity: 1, buyPrice: -1, sellPrice: 100 })).toThrow();
    expect(() => priceLine({ variantId: 'v1', quantity: 1, buyPrice: 1, sellPrice: -100 })).toThrow();
  });

  it('UT-PRICE-04 rounds the unit price down so it never overstates what was paid', () => {
    const line = priceLine({ variantId: 'v1', quantity: 3, buyPrice: 0, sellPrice: 1000, lineDiscount: 1 }, at);
    expect(line.finalPrice).toBe(2999);
    expect(line.unitPrice).toBe(999);
  });

  it('UT-PRICE-05 lists only below-cost lines as below cost', () => {
    const sale = priceSale(
      [
        { variantId: 'ok', quantity: 1, buyPrice: 500, sellPrice: 1000 },
        { variantId: 'loss', quantity: 1, buyPrice: 900, sellPrice: 1000, lineDiscount: 200 },
      ],
      at
    );
    expect(sale.belowCostLines.map((line) => line.variantId)).toEqual(['loss']);
    expect(sale.profit).toBe(1800 - 1400);
  });

  it('UT-PRICE-06 prices an empty basket as zero', () => {
    expect(priceSale([], at)).toMatchObject({ subtotal: 0, total: 0, profit: 0 });
  });
});

describe('UT-PAY payment validation', () => {
  it('UT-PAY-01 needs at least one payment', () => {
    expect(validatePayments(1000, [])).toEqual(['A sale needs at least one payment']);
  });

  it('UT-PAY-02 rejects a zero or negative payment even when the sum is right', () => {
    const errors = validatePayments(1000, [
      { method: 'cash', amount: 1200 },
      { method: 'cash', amount: -200 },
    ]);
    expect(errors).toContain('A payment must be greater than zero');
  });

  it('UT-PAY-03 reports every problem at once', () => {
    const errors = validatePayments(1000, [{ method: 'mobile_money', amount: 500 }]);
    expect(errors).toHaveLength(2);
  });

  it('UT-PAY-04 accepts cash with no provider', () => {
    expect(validatePayments(1000, [{ method: 'cash', amount: 1000 }])).toEqual([]);
  });
});

describe('UT-STOCK stock', () => {
  const movements: StockMovement[] = [
    { id: 'm1', variantId: 'a', quantityChange: 10, reason: 'opening', createdAt: 't', updatedAt: 't' },
    { id: 'm2', variantId: 'a', quantityChange: -3, reason: 'sale', saleId: 's1', createdAt: 't', updatedAt: 't' },
    { id: 'm3', variantId: 'b', quantityChange: 4, reason: 'opening', createdAt: 't', updatedAt: 't' },
    { id: 'm4', variantId: 'a', quantityChange: -1, reason: 'sale', saleId: 's2', createdAt: 't', updatedAt: 't' },
  ];

  it('UT-STOCK-01 counts only the variant asked for', () => {
    expect(quantityOnHand(movements, 'a')).toBe(6);
    expect(quantityOnHand(movements, 'b')).toBe(4);
    expect(quantityOnHand(movements, 'missing')).toBe(0);
  });

  it('UT-STOCK-02 treats negative stock as out', () => {
    expect(stockState(-2, 3)).toBe('out');
    expect(stockState(0, 0)).toBe('out');
    expect(stockState(1, 0)).toBe('ok');
    expect(isLowStock(4, 3)).toBe(false);
    expect(isLowStock(3, 3)).toBe(true);
  });

  it('UT-STOCK-03 applies a movement either way', () => {
    expect(applyMovement(5, -7)).toBe(-2);
    expect(applyMovement(5, 3)).toBe(8);
  });

  it('UT-STOCK-04 reverses only the sale movements of the sale being voided', () => {
    const reversals = reversalFor(movements, 's1');
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ id: 'void-m2', variantId: 'a', quantityChange: 3, reason: 'void' });
  });

  it('UT-STOCK-05 gives a replayed void the same ids, so it cannot restore twice', () => {
    expect(reversalFor(movements, 's1').map((m) => m.id)).toEqual(reversalFor(movements, 's1').map((m) => m.id));
  });
});

describe('UT-REC reconciliation matching', () => {
  const sale = (id: string, amount: number, at: string, extra = {}) => ({ id, amount, at, ...extra });

  it('UT-REC-01 normalises references for comparison', () => {
    expect(normaliseReference('  ab 12 cd ')).toBe('AB12CD');
    expect(normaliseReference(undefined)).toBe('');
  });

  it('UT-REC-02 matches references regardless of case and spaces', () => {
    const result = matchPayments(
      [sale('s1', 1000, '2026-11-17T10:00:00Z', { reference: 'mp 123' })],
      [sale('r1', 1000, '2026-11-17T10:05:00Z', { reference: 'MP123' })],
      30
    );
    expect(result.matched).toEqual([{ saleId: 's1', receivedId: 'r1' }]);
  });

  it('UT-REC-03 accepts a payment exactly at the window edge', () => {
    const result = matchPayments(
      [sale('s1', 1000, '2026-11-17T10:00:00Z')],
      [sale('r1', 1000, '2026-11-17T10:30:00Z')],
      30
    );
    expect(result.matched).toHaveLength(1);
  });

  it('UT-REC-04 reports unused received payments', () => {
    const result = matchPayments(
      [sale('s1', 1000, '2026-11-17T10:00:00Z')],
      [sale('r1', 1000, '2026-11-17T10:01:00Z'), sale('r2', 2500, '2026-11-17T10:02:00Z')],
      30
    );
    expect(result.unmatchedReceived).toEqual(['r2']);
  });

  it('UT-REC-05 a payment that fits two sales leaves both for review', () => {
    const result = matchPayments(
      [sale('s1', 1000, '2026-11-17T10:00:00Z'), sale('s2', 1000, '2026-11-17T10:10:00Z')],
      [sale('r1', 1000, '2026-11-17T10:05:00Z')],
      30
    );
    expect(result.matched).toEqual([]);
    expect(result.ambiguousSales.sort()).toEqual(['s1', 's2']);
    expect(result.unmatchedReceived).toEqual(['r1']);
  });

  it('UT-REC-06 handles empty inputs', () => {
    expect(matchPayments([], [], 30)).toEqual({
      matched: [],
      unmatchedSales: [],
      unmatchedReceived: [],
      ambiguousSales: [],
    });
  });

  it('UT-REC-07 reports a cash surplus as a positive variance', () => {
    expect(cashVariance(5000, 20000, 26000)).toEqual({ expected: 25000, variance: 1000 });
  });
});

describe('UT-TAX turnover tax', () => {
  it('UT-TAX-01 switches to income tax at exactly the threshold (ZRA: below K5M only)', () => {
    expect(estimateTurnoverTax(rules.threshold - 1, rules).eligible).toBe(true);
    const at = estimateTurnoverTax(rules.threshold, rules);
    expect(at.eligible).toBe(false);
    expect(at.incomeTax).toBe(true);
    expect(at.estimatedTax).toBe(0);
  });

  it('UT-TAX-02 rounds the estimate to whole ngwee', () => {
    expect(estimateTurnoverTax(1013, rules).estimatedTax).toBe(41);
  });

  it('UT-TAX-03 reports an over-funded pot as a negative difference', () => {
    expect(potStatus(1000, 1500)).toEqual({ state: 'over', difference: -500 });
  });

  it('UT-TAX-04 builds February periods in leap and common years', () => {
    expect(taxPeriodForMonth('2028-02-10', rules).endsOn).toBe('2028-02-29');
    expect(taxPeriodForMonth('2027-02-10', rules).endsOn).toBe('2027-02-28');
  });

  it('UT-TAX-05 rolls a December due date into the next year', () => {
    expect(taxPeriodForMonth('2026-12-05', rules)).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2026-12-31',
      dueOn: '2027-01-14',
    });
  });

  it('UT-TAX-06 drops negative reminder offsets and sorts the rest', () => {
    expect(reminderDates('2026-12-14', { ...rules, reminderDaysBefore: [0, -2, 7] })).toEqual([
      '2026-12-07',
      '2026-12-14',
    ]);
  });

  it('UT-TAX-07 sets aside nothing on a tiny sale rather than rounding up', () => {
    expect(autoSetAside(24, rules)).toBe(0);
    expect(autoSetAside(25, rules)).toBe(1);
  });
});

describe('UT-ZRA rules from ZRA (18 Nov 2026)', () => {
  const zra: TaxRules = { ...rules, rate: 0.05, threshold: toNgwee(5_000_000), thresholdBasis: 'year' };

  it('UT-ZRA-01 the shipped rules file holds 5%, K5M, yearly basis, due 14 days after month end', () => {
    expect(shippedTaxRules.rate).toBe(0.05);
    expect(shippedTaxRules.threshold).toBe(toNgwee(5_000_000));
    expect(shippedTaxRules.thresholdBasis).toBe('year');
    expect(shippedTaxRules.dueDaysAfterPeriod).toBe(14);
  });

  it('UT-ZRA-02 taxes a month at 5%', () => {
    expect(estimateTurnoverTax(toNgwee(20_000), zra).estimatedTax).toBe(toNgwee(1_000));
  });

  it('UT-ZRA-03 a small month is still income tax once sales this year reach K5M', () => {
    const estimate = estimateTurnoverTax(toNgwee(20_000), zra, toNgwee(5_000_000));
    expect(estimate.incomeTax).toBe(true);
    expect(estimate.estimatedTax).toBe(0);
  });

  it('UT-ZRA-04 a big month alone does not count as income tax while the year is below K5M', () => {
    const estimate = estimateTurnoverTax(toNgwee(600_000), zra, toNgwee(4_000_000));
    expect(estimate.incomeTax).toBe(false);
    expect(estimate.estimatedTax).toBe(toNgwee(30_000));
  });

  it('UT-ZRA-05 every monthly return is due on the 14th of the next month', () => {
    for (const today of ['2026-01-20', '2026-02-03', '2026-04-30', '2026-11-18', '2028-02-29']) {
      expect(taxPeriodForMonth(today, zra).dueOn.slice(8)).toBe('14');
    }
  });
});

describe('UT-ID ids and dates', () => {
  it('UT-ID-01 prefixes ids and does not repeat them', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('sale')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^sale_[0-9a-z]+$/);
  });

  it('UT-ID-02 gives the Lusaka date, not the UTC date, just after midnight', () => {
    // 23:30 UTC on the 16th is 01:30 on the 17th in Lusaka.
    expect(todayLocal(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-17');
  });

  it('UT-ID-03 bounds a day across a month end', () => {
    const [start, end] = localDayBounds('2026-11-30');
    expect(start).toBe('2026-11-29T22:00:00.000Z');
    expect(end).toBe('2026-11-30T22:00:00.000Z');
  });
});

describe('UT-BAR barcodes', () => {
  it('UT-BAR-01 refuses a check digit for the wrong length', () => {
    expect(() => ean13CheckDigit('123')).toThrow();
  });

  it('UT-BAR-02 accepts spaces inside a printed code', () => {
    expect(isValidEan13('600 1234 500018')).toBe(true);
  });

  it('UT-BAR-03 rejects letters and the wrong length', () => {
    expect(isValidEan13('60012345000A1')).toBe(false);
    expect(isValidEan13('600123450001')).toBe(false);
  });

  it('UT-BAR-04 always encodes 95 modules', () => {
    expect(encodeEan13(generateInStoreBarcode(() => 0.5))).toHaveLength(95);
  });

  it('UT-BAR-05 does not call a supplier code an in-store code', () => {
    expect(isInStoreBarcode('6001234500018')).toBe(false);
    expect(isInStoreBarcode(generateInStoreBarcode())).toBe(true);
  });

  it('UT-BAR-06 leaves non-UPC input alone apart from spaces', () => {
    expect(normaliseBarcode(' ABC 123 ')).toBe('ABC123');
    expect(normaliseBarcode('6001234500011')).toBe('6001234500011');
  });
});
