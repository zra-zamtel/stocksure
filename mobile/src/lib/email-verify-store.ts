import Storage from 'expo-sqlite/kv-store';

/**
 * Remembers, on this phone, that the owner's email still needs confirming
 * after sign-up, so Home can keep a gentle reminder up until the emailed
 * link is opened. The server stays the authority; this only drives the UI.
 */
const KEY = 'stocksure.emailPending';

export type EmailPending = { email: string; sent: boolean };

export function readEmailPending(): EmailPending | null {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<EmailPending>;
    return typeof value.email === 'string' ? { email: value.email, sent: value.sent !== false } : null;
  } catch {
    return null;
  }
}

export function markEmailPending(email: string, sent: boolean): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify({ email, sent }));
  } catch {
    // Only the reminder is lost; the emailed link still works.
  }
}

export function clearEmailPending(): void {
  try {
    Storage.removeItemSync(KEY);
  } catch {
    // Nothing to clear.
  }
}
