/**
 * Brute-force protection for the offline PIN.
 *
 * Wrong PINs are counted on this phone. After the third one every further
 * wrong PIN costs a longer wait, and after ten the phone refuses the PIN
 * altogether until the owner signs in online with email and password.
 *
 * Waits are timed with the phone's uptime clock, not the wall clock, so moving
 * the date forward does not shorten them. A restart resets uptime, so after a
 * restart the whole wait starts again: restarting can never make it shorter.
 * Clearing the app's data erases the local shop with it, so it unlocks nothing.
 */

export const ONLINE_AFTER_FAILURES = 10;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The wait after the Nth wrong PIN in a row. Wrong PINs 1 and 2 cost nothing. */
export function cooldownMsAfter(failures: number): number {
  if (failures < 3 || failures >= ONLINE_AFTER_FAILURES) return 0;
  if (failures <= 4) return 30 * SECOND;
  if (failures <= 6) return MINUTE;
  if (failures <= 8) return 5 * MINUTE;
  return 15 * MINUTE;
}

export type GuardState = {
  failures: number;
  /** How long the current wait lasts. */
  lockedForMs: number;
  /** Phone uptime when the wait started, or null when it must restart. */
  lockedAtUptime: number | null;
};

export type GuardStatus = {
  remainingMs: number;
  requiresOnline: boolean;
  failures: number;
};

export const CLEAN_STATE: GuardState = { failures: 0, lockedForMs: 0, lockedAtUptime: null };

/** Records one more wrong PIN and starts the wait it earns. */
export function registerFailure(state: GuardState, uptimeNow: number): GuardState {
  const failures = state.failures + 1;
  const lockedForMs = cooldownMsAfter(failures);
  return { failures, lockedForMs, lockedAtUptime: lockedForMs > 0 ? uptimeNow : null };
}

/**
 * What the phone should do now, plus the state to save. A wait whose start is
 * ahead of the current uptime means the phone restarted, so it begins again.
 */
export function evaluate(state: GuardState, uptimeNow: number): { status: GuardStatus; next: GuardState } {
  if (state.failures >= ONLINE_AFTER_FAILURES) {
    return { status: { remainingMs: 0, requiresOnline: true, failures: state.failures }, next: state };
  }
  if (state.lockedForMs <= 0) {
    return { status: { remainingMs: 0, requiresOnline: false, failures: state.failures }, next: state };
  }
  const restarted = state.lockedAtUptime === null || uptimeNow < state.lockedAtUptime;
  const next = restarted ? { ...state, lockedAtUptime: uptimeNow } : state;
  const elapsed = uptimeNow - (next.lockedAtUptime ?? uptimeNow);
  const remainingMs = Math.max(0, state.lockedForMs - elapsed);
  return { status: { remainingMs, requiresOnline: false, failures: state.failures }, next };
}

/** "30 seconds", "1 minute", "5 minutes": how long to show for a wait. */
export function waitLabelParts(ms: number): { unit: 'seconds' | 'minutes'; count: number } {
  const seconds = Math.max(1, Math.ceil(ms / SECOND));
  if (seconds <= 90) return { unit: 'seconds', count: seconds };
  return { unit: 'minutes', count: Math.ceil(seconds / 60) };
}
