// Formatting helpers. Amounts are always whole ngwee internally and only
// rendered as Kwacha at the edge, so no rounding error creeps into a total.
const kwacha = new Intl.NumberFormat('en-ZM', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatKwacha(amountInNgwee: number): string {
  const sign = amountInNgwee < 0 ? '-' : '';
  return `${sign}K ${kwacha.format(Math.abs(amountInNgwee) / 100)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-ZM').format(value);
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-ZM', { day: '2-digit', month: 'short' }).format(new Date(isoDate));
}

// One date style everywhere: day/month/year, the way dates are written locally.
// Built by hand so every phone shows the same thing whatever its Intl data.
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Accepts an ISO timestamp or a plain YYYY-MM-DD day (read as that local day). */
function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

/** 25/11/2026 */
export function formatDay(value: string): string {
  const date = toDate(value);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** 14:05 */
export function formatTime(value: string): string {
  const date = toDate(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 25/11/2026 14:05 */
export function formatDateTime(value: string): string {
  return `${formatDay(value)} ${formatTime(value)}`;
}

/** The local calendar day of a timestamp, as YYYY-MM-DD, for grouping lists. */
export function localDayKey(value: string): string {
  const date = toDate(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
