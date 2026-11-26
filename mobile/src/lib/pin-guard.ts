import * as Device from 'expo-device';
import Storage from 'expo-sqlite/kv-store';
import {
  CLEAN_STATE,
  evaluate,
  registerFailure,
  type GuardState,
  type GuardStatus,
} from './pin-policy';

export { waitLabelParts, ONLINE_AFTER_FAILURES, type GuardStatus } from './pin-policy';

/** Brute-force protection for the offline PIN: the rules are in `pin-policy.ts`; this keeps them on the phone. */

// ---- storage on the phone ------------------------------------------------

const KEY = 'stocksure.pinGuard';

export function readGuardState(): GuardState {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return CLEAN_STATE;
    const value = JSON.parse(raw) as Partial<GuardState>;
    const failures = Number.isInteger(value.failures) && (value.failures as number) > 0 ? (value.failures as number) : 0;
    const lockedForMs = typeof value.lockedForMs === 'number' && value.lockedForMs > 0 ? value.lockedForMs : 0;
    const lockedAtUptime = typeof value.lockedAtUptime === 'number' ? value.lockedAtUptime : null;
    return { failures, lockedForMs, lockedAtUptime };
  } catch {
    return CLEAN_STATE;
  }
}

function writeGuardState(state: GuardState): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(state));
  } catch {
    // Without storage the counter lives only until the app closes.
  }
}

/** Phone uptime in ms. Falls back to the wall clock where the phone gives none. */
async function uptimeNow(): Promise<number> {
  try {
    return await Device.getUptimeAsync();
  } catch {
    return Date.now();
  }
}

/** Where the phone stands now, and remembers a restarted wait. */
export async function pinGuardStatus(): Promise<GuardStatus> {
  const { status, next } = evaluate(readGuardState(), await uptimeNow());
  writeGuardState(next);
  return status;
}

export async function recordWrongPin(): Promise<GuardStatus> {
  const state = registerFailure(readGuardState(), await uptimeNow());
  writeGuardState(state);
  return evaluate(state, await uptimeNow()).status;
}

/** A right PIN, or any successful online sign-in, clears the count. */
export function clearPinGuard(): void {
  writeGuardState(CLEAN_STATE);
}
