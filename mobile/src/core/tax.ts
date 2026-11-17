import { roundNgwee } from './money';
import type { Ngwee, TaxRules } from './types';

export interface TaxEstimate {
  turnover: Ngwee;
  rate: number;
  estimatedTax: Ngwee;
  eligible: boolean;
  threshold: Ngwee;
}

/**
 * Turnover tax is a small-business regime. The rate, threshold, period and due
 * date come from the rules file, never from code, so they can be corrected
 * without shipping a new build.
 *
 * Above the threshold the business is not on turnover tax at all, so this
 * returns a zero estimate and `eligible: false` rather than inventing a figure.
 */
export function estimateTurnoverTax(turnover: Ngwee, rules: TaxRules): TaxEstimate {
  const eligible = turnover > 0 && turnover <= rules.threshold;
  return {
    turnover,
    rate: rules.rate,
    estimatedTax: eligible ? roundNgwee(turnover * rules.rate) : 0,
    eligible,
    threshold: rules.threshold,
  };
}

export type PotState = 'short' | 'covered' | 'over';

export interface PotStatus {
  state: PotState;
  difference: Ngwee; // positive means short
}

export function potStatus(estimatedTax: Ngwee, potBalance: Ngwee): PotStatus {
  const difference = estimatedTax - potBalance;
  if (difference > 0) return { state: 'short', difference };
  if (difference === 0) return { state: 'covered', difference: 0 };
  return { state: 'over', difference };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dueDateFor(periodEndsOn: string, rules: TaxRules): string {
  return addDays(periodEndsOn, rules.dueDaysAfterPeriod);
}

/** Days-before values are inclusive of the due date, which is why 0 is allowed. */
export function reminderDates(dueOn: string, rules: TaxRules): string[] {
  return rules.reminderDaysBefore
    .filter((days) => days >= 0)
    .map((days) => addDays(dueOn, -days))
    .sort();
}

/** Money set aside on each sale, rounded down so the pot never overstates cover. */
export function autoSetAside(saleTotal: Ngwee, rules: TaxRules): Ngwee {
  return Math.floor(saleTotal * rules.rate);
}
