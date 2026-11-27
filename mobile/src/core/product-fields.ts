// Optional product fields some trades need: unit, expiry, batch and a warning
// shown before a sale. Framework-free so the rules run in plain Node tests.

/** The warnings the product form offers. Stored as this text on the product. */
export const SALE_WARNING_RX = 'Rx only';
export const SALE_WARNING_AGE = '18+';
export const SALE_WARNINGS = [SALE_WARNING_RX, SALE_WARNING_AGE] as const;

/** Default for products saved before units existed. */
export const DEFAULT_UNIT = 'piece';

/**
 * A real calendar date in YYYY-MM-DD form. A regex alone would accept
 * 2026-02-30; this round-trips through Date so impossible days are refused.
 */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Expired means the expiry day is before today; stock is still good on its expiry day. */
export function isExpired(expiryDate: string | undefined | null, today: string): boolean {
  if (!expiryDate || !isValidIsoDate(expiryDate)) return false;
  return expiryDate < today;
}

export interface WarningLine {
  /** What the owner sees for this line, e.g. "Panadol · 500 mg". */
  label: string;
  saleWarning?: string;
  expiryDate?: string;
}

export interface SaleWarnings {
  /** Lines carrying "Rx only". */
  rx: string[];
  /** Lines carrying "18+". */
  age: string[];
  /** Lines with any other warning text the shop typed. */
  other: { label: string; warning: string }[];
  /** Lines whose stock is past its expiry date. */
  expired: string[];
}

/** Everything the cashier should confirm before this basket is sold. */
export function collectSaleWarnings(lines: WarningLine[], today: string): SaleWarnings {
  const result: SaleWarnings = { rx: [], age: [], other: [], expired: [] };
  for (const line of lines) {
    const warning = line.saleWarning?.trim();
    if (warning === SALE_WARNING_RX) result.rx.push(line.label);
    else if (warning === SALE_WARNING_AGE) result.age.push(line.label);
    else if (warning) result.other.push({ label: line.label, warning });
    if (isExpired(line.expiryDate, today)) result.expired.push(line.label);
  }
  return result;
}

export function hasSaleWarnings(warnings: SaleWarnings): boolean {
  return (
    warnings.rx.length + warnings.age.length + warnings.other.length + warnings.expired.length > 0
  );
}

/** How far ahead "Expiring soon" looks. */
export const EXPIRY_WARN_DAYS = 30;

/** YYYY-MM-DD plus a number of days, by the calendar (no time zone involved). */
export function addDaysIso(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

export type ExpiryStatus = 'expired' | 'soon' | 'ok';

/** Red once past its expiry day, amber within EXPIRY_WARN_DAYS, otherwise fine. Null without a usable date. */
export function expiryStatus(
  expiryDate: string | undefined | null,
  today: string,
  warnDays = EXPIRY_WARN_DAYS
): ExpiryStatus | null {
  if (!expiryDate || !isValidIsoDate(expiryDate)) return null;
  if (expiryDate < today) return 'expired';
  return expiryDate <= addDaysIso(today, warnDays) ? 'soon' : 'ok';
}
