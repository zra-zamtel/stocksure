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
