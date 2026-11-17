import type { DiscountType, Ngwee, ProductDiscount } from './types';

/**
 * Money is stored as an integer number of ngwee so a total never drifts by a
 * rounding error. Rounding only happens once, at the point a figure is shown
 * or a percentage is turned into an amount.
 */

export function toNgwee(kwacha: number): Ngwee {
  return Math.round(kwacha * 100);
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
