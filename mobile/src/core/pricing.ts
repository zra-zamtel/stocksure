import { clampDiscount, discountAmount, isDiscountActive } from './money';
import type { Ngwee, ProductDiscount } from './types';

export interface LineInput {
  variantId: string;
  quantity: number;
  buyPrice: Ngwee; // cost at the time of sale, saved on the line forever
  sellPrice: Ngwee; // list price per unit
  productDiscount?: ProductDiscount;
  lineDiscount?: Ngwee; // one-off at the counter, whole line
}

export interface PricedLine {
  variantId: string;
  quantity: number;
  buyPrice: Ngwee;
  listPrice: Ngwee;
  discount: Ngwee;
  finalPrice: Ngwee;
  unitPrice: Ngwee;
  profit: Ngwee;
  belowCost: boolean;
}

export interface PricedSale {
  lines: PricedLine[];
  subtotal: Ngwee;
  discountTotal: Ngwee;
  total: Ngwee;
  costTotal: Ngwee;
  profit: Ngwee;
  belowCostLines: PricedLine[];
}

/**
 * Price one line: automatic product discount first, then any one-off counter
 * discount, and never both beyond the list price. A discount that lands under
 * the buy price is flagged, not blocked - section 4 is explicit about that.
 */
export function priceLine(input: LineInput, at: Date = new Date()): PricedLine {
  if (input.quantity <= 0) throw new Error('Quantity must be at least 1');
  if (input.sellPrice < 0 || input.buyPrice < 0) throw new Error('Prices cannot be negative');

  const gross = input.sellPrice * input.quantity;
  const automatic = isDiscountActive(input.productDiscount, at)
    ? discountAmount(gross, input.productDiscount!.type, input.productDiscount!.value)
    : 0;
  const counter = clampDiscount(input.lineDiscount ?? 0, gross - automatic);
  const discount = automatic + counter;
  const finalPrice = gross - discount;
  const unitPrice = Math.floor(finalPrice / input.quantity);

  return {
    variantId: input.variantId,
    quantity: input.quantity,
    buyPrice: input.buyPrice,
    listPrice: gross,
    discount,
    finalPrice,
    unitPrice,
    profit: finalPrice - input.buyPrice * input.quantity,
    belowCost: finalPrice < input.buyPrice * input.quantity,
  };
}

export function priceSale(lines: LineInput[], at: Date = new Date()): PricedSale {
  const priced = lines.map((line) => priceLine(line, at));
  const subtotal = priced.reduce((sum, line) => sum + line.listPrice, 0);
  const discountTotal = priced.reduce((sum, line) => sum + line.discount, 0);
  const total = priced.reduce((sum, line) => sum + line.finalPrice, 0);
  const costTotal = priced.reduce((sum, line) => sum + line.buyPrice * line.quantity, 0);

  return {
    lines: priced,
    subtotal,
    discountTotal,
    total,
    costTotal,
    profit: total - costTotal,
    belowCostLines: priced.filter((line) => line.belowCost),
  };
}

/**
 * Split payments must add up to the sale total before the sale can be
 * confirmed. Mobile money without a reference cannot be reconciled later, so
 * it is rejected here rather than silently accepted.
 */
export interface PaymentInput {
  method: 'cash' | 'mobile_money';
  amount: Ngwee;
  provider?: 'MTN' | 'Airtel' | 'Zamtel';
  reference?: string;
}

export function validatePayments(total: Ngwee, payments: PaymentInput[]): string[] {
  const errors: string[] = [];
  if (payments.length === 0) return ['A sale needs at least one payment'];

  const sum = payments.reduce((acc, payment) => acc + payment.amount, 0);
  if (sum !== total) errors.push(`Payments total ${sum} does not match sale total ${total}`);

  for (const payment of payments) {
    if (payment.amount <= 0) errors.push('A payment must be greater than zero');
    if (payment.method === 'mobile_money') {
      if (!payment.provider) errors.push('Mobile money needs a provider');
      if (!payment.reference?.trim()) errors.push('Mobile money needs a transaction reference');
    }
  }
  return errors;
}
