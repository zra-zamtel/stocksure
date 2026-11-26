import type { DiscountType, Ngwee, ProductDiscount } from './types';

/**
 * Money is stored as an integer number of ngwee so a total never drifts by a
 * rounding error. Rounding only happens once, at the point a figure is shown
 * or a percentage is turned into an amount.
 */

export function toNgwee(kwacha: number): Ngwee {
  return Math.round(kwacha * 100);
}

export type PriceError = 'empty' | 'malformed' | 'negative' | 'zero' | 'decimals' | 'tooLarge';

/** The largest price a shop can enter: K10,000,000.00. */
export const MAX_PRICE_NGWEE = 1_000_000_000;

/**
 * Keep only what a price can contain while the owner types: digits and one
 * decimal separator. A minus sign, letters and a second separator are dropped
 * as they land, so they never reach the saved value (some phone keyboards show
 * a minus key on the decimal pad).
 */
export function sanitisePriceInput(text: string): string {
  let seen = false;
  let out = '';
  for (const char of text) {
    if (char >= '0' && char <= '9') out += char;
    else if ((char === '.' || char === ',') && !seen) {
      seen = true;
      out += char;
    }
  }
  return out;
}

/**
 * Turns what the owner typed into ngwee, or says what is wrong with it. Both
 * `350.50` and `350,50` are accepted; negatives, zero, three decimals, a second
 * separator and absurd amounts are not.
 */
export function parsePrice(text: string): { ok: true; ngwee: Ngwee } | { ok: false; error: PriceError } {
  const value = text.trim();
  if (value === '') return { ok: false, error: 'empty' };
  if (value.startsWith('-')) return { ok: false, error: 'negative' };
  if (!/^\d*[.,]?\d*$/.test(value) || !/\d/.test(value)) return { ok: false, error: 'malformed' };
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  if (fraction.length > 2) return { ok: false, error: 'decimals' };
  const ngwee = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (ngwee === 0) return { ok: false, error: 'zero' };
  if (ngwee > MAX_PRICE_NGWEE) return { ok: false, error: 'tooLarge' };
  return { ok: true, ngwee };
}

export function toKwacha(ngwee: Ngwee): number {
  return ngwee / 100;
}

/** Round half up, unlike Math.round on negatives. Discount amounts are never negative. */
export function roundNgwee(value: number): Ngwee {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function percentOf(amount: Ngwee, percent: number): Ngwee {
  return roundNgwee((amount * percent) / 100);
}

export function clampDiscount(discount: Ngwee, listPrice: Ngwee): Ngwee {
  if (discount < 0) return 0;
  return Math.min(discount, listPrice);
}

/**
 * A product discount applies automatically only while it is active. Dates are
 * optional, and the boundaries are inclusive so a sale on the end date still
 * gets the discount.
 */
export function isDiscountActive(discount: ProductDiscount | undefined, at: Date): boolean {
  if (!discount || !discount.enabled) return false;
  if (discount.startsAt && at.getTime() < new Date(discount.startsAt).getTime()) return false;
  if (discount.endsAt && at.getTime() > new Date(discount.endsAt).getTime()) return false;
  return true;
}

export function discountAmount(
  listPrice: Ngwee,
  type: DiscountType,
  value: number
): Ngwee {
  if (value <= 0) return 0;
  const amount = type === 'percent' ? percentOf(listPrice, value) : value;
  return clampDiscount(roundNgwee(amount), listPrice);
}
