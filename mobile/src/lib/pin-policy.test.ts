import { describe, expect, it } from 'vitest';
import {
  CLEAN_STATE,
  ONLINE_AFTER_FAILURES,
  cooldownMsAfter,
  evaluate,
  registerFailure,
  waitLabelParts,
  type GuardState,
} from './pin-policy';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function failTimes(count: number, uptime = 0): GuardState {
  let state = CLEAN_STATE;
  for (let i = 0; i < count; i += 1) state = registerFailure(state, uptime);
  return state;
}

describe('UT-PIN-GUARD wrong-PIN lockout', () => {
  it('UT-PIN-GUARD-01 lets the first two wrong PINs through without a wait', () => {
    expect(cooldownMsAfter(1)).toBe(0);
    expect(cooldownMsAfter(2)).toBe(0);
    expect(evaluate(failTimes(2), 0).status.remainingMs).toBe(0);
  });

  it('UT-PIN-GUARD-02 makes the waits longer as wrong PINs pile up', () => {
    expect([3, 4, 5, 6, 7, 8, 9].map(cooldownMsAfter)).toEqual([
      30 * SECOND, 30 * SECOND, MINUTE, MINUTE, 5 * MINUTE, 5 * MINUTE, 15 * MINUTE,
    ]);
  });

  it('UT-PIN-GUARD-03 counts the wait down on the uptime clock', () => {
    const state = failTimes(3, 1_000);
    expect(evaluate(state, 1_000).status.remainingMs).toBe(30 * SECOND);
    expect(evaluate(state, 1_000 + 10 * SECOND).status.remainingMs).toBe(20 * SECOND);
    expect(evaluate(state, 1_000 + 31 * SECOND).status.remainingMs).toBe(0);
  });

  it('UT-PIN-GUARD-04 starts the whole wait again after a restart, never a shorter one', () => {
    const state = failTimes(5, 900_000); // a 1 minute wait that began 15 minutes after boot
    // After a restart uptime is small again, so uptime is behind where the wait began.
    const after = evaluate(state, 5_000);
    expect(after.status.remainingMs).toBe(MINUTE);
    expect(after.next.lockedAtUptime).toBe(5_000);
    // The next look counts down from the restarted wait.
    expect(evaluate(after.next, 5_000 + 20 * SECOND).status.remainingMs).toBe(40 * SECOND);
  });

  it('UT-PIN-GUARD-05 asks for online sign-in after ten wrong PINs and stays that way', () => {
    expect(cooldownMsAfter(ONLINE_AFTER_FAILURES)).toBe(0);
    const state = failTimes(ONLINE_AFTER_FAILURES);
    expect(evaluate(state, 0).status.requiresOnline).toBe(true);
    // No amount of waiting reopens the PIN.
    expect(evaluate(state, 24 * 60 * MINUTE).status.requiresOnline).toBe(true);
    expect(evaluate(failTimes(ONLINE_AFTER_FAILURES - 1), 0).status.requiresOnline).toBe(false);
  });

  it('UT-PIN-GUARD-06 starts clean', () => {
    const { status } = evaluate(CLEAN_STATE, 12_345);
    expect(status).toEqual({ remainingMs: 0, requiresOnline: false, failures: 0 });
  });

  it('UT-PIN-GUARD-07 shows seconds up to a minute and a half, then whole minutes', () => {
    expect(waitLabelParts(30 * SECOND)).toEqual({ unit: 'seconds', count: 30 });
    expect(waitLabelParts(1)).toEqual({ unit: 'seconds', count: 1 });
    expect(waitLabelParts(MINUTE)).toEqual({ unit: 'seconds', count: 60 });
    expect(waitLabelParts(5 * MINUTE)).toEqual({ unit: 'minutes', count: 5 });
    expect(waitLabelParts(14 * MINUTE + 10 * SECOND)).toEqual({ unit: 'minutes', count: 15 });
  });
});
