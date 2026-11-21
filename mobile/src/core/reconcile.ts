import type { Ngwee } from './types';

/**
 * MerchantMatch: pairing a recorded mobile money sale with a payment read from
 * the provider's confirmation message.
 *
 * The message that arrives on the shop phone carries the reference, so a
 * cashier is not asked to type one. A pair matches when the amount and provider
 * agree and the times are close. The reference only decides when both sides
 * have one (the customer read it out and the cashier typed it): then it must
 * agree. A reference on the message alone is the normal case and is no reason
 * to refuse a match.
 *
 * The match is one-to-one. A sale with several fitting payments is reported as
 * ambiguous rather than guessed, because a wrong match quietly moves money into
 * the tax estimate.
 */

export interface MatchCandidate {
  id: string;
  amount: Ngwee;
  reference?: string;
  provider?: string;
  at: string;
}

export interface MatchResult {
  matched: { saleId: string; receivedId: string }[];
  unmatchedSales: string[];
  unmatchedReceived: string[];
  /** Sales with more than one payment that fits: a human must choose. */
  ambiguousSales: string[];
}

export function normaliseReference(reference: string | undefined): string {
  return (reference ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

function fitsSale(sale: MatchCandidate, payment: MatchCandidate, windowMinutes: number): boolean {
  if (payment.amount !== sale.amount) return false;
  if (sale.provider && payment.provider && sale.provider !== payment.provider) return false;
  if (minutesBetween(sale.at, payment.at) > windowMinutes) return false;

  const saleRef = normaliseReference(sale.reference);
  const paymentRef = normaliseReference(payment.reference);
  // Both typed and received: they must be the same payment. Otherwise amount,
  // provider and time decide, and two equal fits go to the owner as ambiguous.
  if (saleRef && paymentRef) return saleRef === paymentRef;
  return true;
}

export function matchPayments(
  sales: MatchCandidate[],
  received: MatchCandidate[],
  windowMinutes: number
): MatchResult {
  const used = new Set<string>();
  const matched: MatchResult['matched'] = [];
  const unmatchedSales: string[] = [];
  const ambiguousSales: string[] = [];

  const ordered = [...sales].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Every fitting pair, computed up front, so ambiguity is judged from both
  // sides: a payment that fits two sales is as ambiguous as a sale that fits
  // two payments, and neither is decided by which sale happened to come first.
  const fits = new Map(ordered.map((sale) => [sale.id, received.filter((payment) => fitsSale(sale, payment, windowMinutes))]));
  const salesPerPayment = new Map<string, number>();
  for (const candidates of fits.values()) {
    for (const payment of candidates) {
      salesPerPayment.set(payment.id, (salesPerPayment.get(payment.id) ?? 0) + 1);
    }
  }

  for (const sale of ordered) {
    const candidates = fits.get(sale.id) ?? [];
    if (candidates.length === 0) {
      unmatchedSales.push(sale.id);
    } else if (candidates.length === 1 && salesPerPayment.get(candidates[0].id) === 1) {
      used.add(candidates[0].id);
      matched.push({ saleId: sale.id, receivedId: candidates[0].id });
    } else {
      ambiguousSales.push(sale.id);
    }
  }

  return {
    matched,
    unmatchedSales,
    unmatchedReceived: received
      .filter((payment) => !used.has(payment.id))
      .map((payment) => payment.id),
    ambiguousSales,
  };
}

/** Cash at closing: opening float plus recorded cash sales, compared to what is counted. */
export function cashVariance(
  openingFloat: Ngwee,
  cashSales: Ngwee,
  countedCash: Ngwee
): { expected: Ngwee; variance: Ngwee } {
  const expected = openingFloat + cashSales;
  return { expected, variance: countedCash - expected };
}
