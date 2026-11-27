import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/session';
import { ApiError } from '@/lib/api';
import { syncNow, syncStatus, type SyncRunResult, type SyncStatus } from './sync';

/**
 * Why the last sync did not finish, in the owner's terms. Raw server text
 * (such as JWT errors) never reaches the screen: each kind maps to a plain
 * message with something to do about it.
 * - expired: the sign-in on this phone ran out; an email code reconnects it.
 * - offline: no signal; changes stay on the phone and go later.
 * - server: the server refused or failed; trying again later usually works.
 */
export type SyncProblem = 'expired' | 'offline' | 'server';

let problem: SyncProblem | null = null;
const listeners = new Set<() => void>();

function setProblem(next: SyncProblem | null) {
  if (problem === next) return;
  problem = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets the last problem, e.g. after a hand-over so the next owner starts clean. */
export function resetSyncProblem(): void {
  setProblem(null);
}

/** The latest sync problem, shared by every screen that shows it. */
export function useSyncProblem(): SyncProblem | null {
  return useSyncExternalStore(subscribe, () => problem, () => problem);
}

function classify(cause: unknown): SyncProblem {
  if (cause instanceof ApiError) {
    if (cause.code === 'unauthorized') return 'expired';
    if (cause.code === 'offline') return 'offline';
  }
  return 'server';
}

/**
 * Sync once, renewing the device key on a 401 and retrying. The key lasts
 * hours; the refresh key lasts weeks, so most owners never see "expired".
 */
async function syncRenewing(
  db: SQLiteDatabase,
  token: string,
  renew: () => Promise<string | null>
): Promise<SyncRunResult> {
  try {
    return await syncNow(db, token);
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.code !== 'unauthorized') throw cause;
    const renewed = await renew();
    if (!renewed) throw cause;
    return syncNow(db, renewed);
  }
}

/** Status and a manual trigger for the Settings screen. */
export function useSync() {
  const db = useSQLiteContext();
  const { deviceToken, renewDeviceToken } = useAuth();
  const [status, setStatus] = useState<SyncStatus>({
    pending: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const [busy, setBusy] = useState(false);
  const current = useSyncProblem();

  const refresh = useCallback(async () => {
    setStatus(await syncStatus(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const run = useCallback(async () => {
    if (!deviceToken) {
      setProblem('expired');
      return;
    }
    setBusy(true);
    try {
      await syncRenewing(db, deviceToken, renewDeviceToken);
      setProblem(null);
    } catch (cause) {
      setProblem(classify(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [db, deviceToken, renewDeviceToken, refresh]);

  return { ...status, busy, problem: current, syncNow: run, refresh };
}

/** One best-effort push/pull when the tabs open. */
export function useAutoSync() {
  const db = useSQLiteContext();
  const { deviceToken, renewDeviceToken } = useAuth();
  // Run when the phone becomes connected, not again each time the key renews.
  const connected = deviceToken !== null;

  useEffect(() => {
    if (!deviceToken) return;
    syncRenewing(db, deviceToken, renewDeviceToken)
      .then(() => setProblem(null))
      .catch((cause: unknown) => {
        // The outbox keeps the rows either way. Offline is normal and not
        // worth a banner on Home; an expired sign-in is, because nothing will
        // upload until the owner reconnects.
        const kind = classify(cause);
        if (kind !== 'offline') setProblem(kind);
      });
    // Renewing changes deviceToken; the retry already happened inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, connected]);
}

/** For other screens that sync before an online call (Smart Invoice, Trading Record). */
export function useSyncRenewing() {
  const db = useSQLiteContext();
  const { renewDeviceToken } = useAuth();
  return useCallback(
    (token: string) => syncRenewing(db, token, renewDeviceToken),
    [db, renewDeviceToken]
  );
}
