import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/session';
import { syncNow, syncStatus, type SyncStatus } from './sync';

/** Status and a manual trigger for the Settings screen. */
export function useSync() {
  const db = useSQLiteContext();
  const { deviceToken } = useAuth();
  const [status, setStatus] = useState<SyncStatus>({
    pending: 0,
    lastSyncAt: null,
    lastError: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Sign in again before syncing.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await syncNow(db, deviceToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [db, deviceToken, refresh]);

  return { ...status, busy, error, syncNow: run, refresh };
}

/** One best-effort push/pull when the tabs open. Offline is not an error. */
export function useAutoSync() {
  const db = useSQLiteContext();
  const { deviceToken } = useAuth();

  useEffect(() => {
    if (!deviceToken) return;
    void syncNow(db, deviceToken).catch(() => {
      // The outbox keeps the rows; the next manual sync retries.
    });
  }, [db, deviceToken]);
}
