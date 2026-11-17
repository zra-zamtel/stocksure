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
