import { describe, expect, it } from 'vitest';
import { MAX_PRICE_NGWEE, parsePrice, sanitisePriceInput } from './money';
import { MAX_LINE_QUANTITY, maxSellable } from './stock';

describe('UT-PRICE price entry (QA-07)', () => {
  it('UT-PRICE-01 reads normal prices, with a dot or a comma', () => {
    expect(parsePrice('350')).toEqual({ ok: true, ngwee: 35000 });
    expect(parsePrice('350.5')).toEqual({ ok: true, ngwee: 35050 });
    expect(parsePrice('350,50')).toEqual({ ok: true, ngwee: 35050 });
    expect(parsePrice(' 0.05 ')).toEqual({ ok: true, ngwee: 5 });
    expect(parsePrice('.75')).toEqual({ ok: true, ngwee: 75 });
  });

  it('UT-PRICE-02 rejects a minus sign and says why', () => {
    expect(parsePrice('-50')).toEqual({ ok: false, error: 'negative' });
    expect(parsePrice('-0')).toEqual({ ok: false, error: 'negative' });
  });

  it('UT-PRICE-03 rejects zero in every spelling', () => {
    for (const text of ['0', '0.00', '0,0', '00']) {
      expect(parsePrice(text)).toEqual({ ok: false, error: 'zero' });
    }
  });

  it('UT-PRICE-04 rejects malformed numbers instead of guessing', () => {
    for (const text of ['1.2.3', '1,2,3', 'abc', '12a', '1e5', '5-', '.', ',', '1 000']) {
      expect(parsePrice(text)).toEqual({ ok: false, error: 'malformed' });
    }
    expect(parsePrice('')).toEqual({ ok: false, error: 'empty' });
    expect(parsePrice('   ')).toEqual({ ok: false, error: 'empty' });
  });

  it('UT-PRICE-05 rejects three decimals and absurdly large amounts', () => {
    expect(parsePrice('12.345')).toEqual({ ok: false, error: 'decimals' });
    expect(parsePrice('10000000')).toEqual({ ok: true, ngwee: MAX_PRICE_NGWEE });
    expect(parsePrice('10000000.01')).toEqual({ ok: false, error: 'tooLarge' });
    expect(parsePrice('99999999999999999999')).toEqual({ ok: false, error: 'tooLarge' });
  });

  it('UT-PRICE-06 drops minus signs, letters and a second separator as they are typed', () => {
    expect(sanitisePriceInput('-50')).toBe('50');
    expect(sanitisePriceInput('1.2.3')).toBe('1.23');
    expect(sanitisePriceInput('1,2.3')).toBe('1,23');
    expect(sanitisePriceInput('12abc')).toBe('12');
    expect(sanitisePriceInput('350,50')).toBe('350,50');
    expect(sanitisePriceInput('')).toBe('');
  });
});

describe('UT-STOCK basket quantity (QA-05)', () => {
  it('UT-STOCK-01 holds staff to the stock on hand', () => {
    expect(maxSellable(9, false)).toBe(9);
    expect(maxSellable(0, false)).toBe(0);
    expect(maxSellable(-3, false)).toBe(0);
    expect(maxSellable(500, false)).toBe(MAX_LINE_QUANTITY);
  });

  it('UT-STOCK-02 lets someone who can approve an override go over, up to the line limit', () => {
    expect(maxSellable(9, true)).toBe(MAX_LINE_QUANTITY);
    expect(maxSellable(0, true)).toBe(MAX_LINE_QUANTITY);
  });
});
