import Storage from 'expo-sqlite/kv-store';

/**
 * Everything notifications remember lives on this phone, in the same
 * key-value store as the language. Nothing goes to the server.
 */

export type NotificationPrefs = { lowStock: boolean; tax: boolean };

const PREFS_KEY = 'stocksure.notify.prefs';
const PROMPT_KEY = 'stocksure.notify.promptDone';
const LOW_STOCK_KEY = 'stocksure.notify.lowStockTold';

/** Cleared when the phone is handed over, so the next owner starts fresh. */
export const NOTIFICATION_STORAGE_KEYS = [PREFS_KEY, PROMPT_KEY, LOW_STOCK_KEY];

const DEFAULT_PREFS: NotificationPrefs = { lowStock: true, tax: true };

export function readPrefs(): NotificationPrefs {
  try {
    const raw = Storage.getItemSync(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      lowStock: parsed.lowStock !== false,
      tax: parsed.tax !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function storePrefs(prefs: NotificationPrefs): void {
  try {
    Storage.setItemSync(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // The switch still holds for this run.
  }
}

export function readPromptDone(): boolean {
  try {
    return Storage.getItemSync(PROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function storePromptDone(): void {
  try {
    Storage.setItemSync(PROMPT_KEY, '1');
  } catch {
    // The card hides for this run and may come back once; harmless.
  }
}

export function readLowStockTold(): string[] {
  try {
    const raw = Storage.getItemSync(LOW_STOCK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function storeLowStockTold(ids: readonly string[]): void {
  try {
    Storage.setItemSync(LOW_STOCK_KEY, JSON.stringify(ids));
  } catch {
    // At worst an item is announced twice.
  }
}

export function forgetNotificationState(): void {
  for (const key of NOTIFICATION_STORAGE_KEYS) {
    try {
      Storage.removeItemSync(key);
    } catch {
      // A key that cannot be removed only keeps an old switch setting.
    }
  }
}
