import type { Ngwee } from './types';

/**
 * MerchantMatch: pairing a recorded mobile money sale with a payment read from
 * the provider's confirmation message.
 *
 * The message that arrives on the shop phone carries the reference, so a
 * cashier is not asked to type one. A pair matches when the amount and provider
 * agree, the times are close, and the references agree or neither side has one.
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

  for (const sale of ordered) {
    const saleRef = normaliseReference(sale.reference);

    const candidates = received.filter((payment) => {
      if (used.has(payment.id)) return false;
      if (payment.amount !== sale.amount) return false;
      if (sale.provider && payment.provider && sale.provider !== payment.provider) return false;
      if (minutesBetween(sale.at, payment.at) > windowMinutes) return false;

      const paymentRef = normaliseReference(payment.reference);
      if (saleRef && paymentRef) return saleRef === paymentRef;
      if (!saleRef && !paymentRef) return true;
      // Only one side has a reference: not enough to say these are the same payment.
      return false;
    });

    if (candidates.length === 1) {
      used.add(candidates[0].id);
      matched.push({ saleId: sale.id, receivedId: candidates[0].id });
    } else if (candidates.length > 1) {
      ambiguousSales.push(sale.id);
    } else {
      unmatchedSales.push(sale.id);
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
