import type { Ngwee } from './types';

/**
 * MerchantMatch: a recorded mobile money sale is matched to a payment read from
 * the provider's confirmation message when the amount and the reference agree
 * and the times are close.
 *
 * The match is one-to-one. Ambiguous cases are left unmatched rather than
 * guessed, because a wrong match quietly moves money into the tax estimate.
 */

export interface MatchCandidate {
  id: string;
  amount: Ngwee;
  reference?: string;
  at: string;
}

export interface MatchResult {
  matched: Array<{ saleId: string; receivedId: string }>;
  unmatchedSales: string[];
  unmatchedReceived: string[];
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

  const ordered = [...sales].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  for (const sale of ordered) {
    const saleRef = normaliseReference(sale.reference);
    const candidate = received.find((payment) => {
      if (used.has(payment.id)) return false;
      if (payment.amount !== sale.amount) return false;
      const paymentRef = normaliseReference(payment.reference);
      if (!saleRef || !paymentRef || paymentRef !== saleRef) return false;
      return minutesBetween(sale.at, payment.at) <= windowMinutes;
    });

    if (candidate) {
      used.add(candidate.id);
      matched.push({ saleId: sale.id, receivedId: candidate.id });
    } else {
      unmatchedSales.push(sale.id);
    }
  }

  return {
    matched,
    unmatchedSales,
    unmatchedReceived: received.filter((payment) => !used.has(payment.id)).map((payment) => payment.id),
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
