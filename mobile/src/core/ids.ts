const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * IDs are created on the phone, never by the server, so a queued change can be
 * replayed safely. Time prefix keeps them sortable; the random suffix makes a
 * collision between two phones effectively impossible.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  let random = '';
  for (let i = 0; i < 10; i += 1) {
    random += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}_${time}${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's calendar date on the phone (YYYY-MM-DD), not the UTC date. */
export function todayLocal(at: Date = new Date()): string {
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * The UTC instants that bound a local calendar day, as [start, end). Stored
 * timestamps are UTC (or carry an offset), so filtering with SQLite's date()
 * would cut the day at UTC midnight instead of the shop's midnight.
 */
export function localDayBounds(day: string): [string, string] {
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year, month - 1, date);
  const end = new Date(year, month - 1, date + 1);
  return [start.toISOString(), end.toISOString()];
}
