import { describe, expect, it } from 'vitest';
import { parsePlanChoice, TRIAL_DAYS, trialDaysLeft } from './plan';

describe('trialDaysLeft', () => {
  const start = '2026-11-01T08:00:00.000Z';

  it('gives the full trial on the first day', () => {
    expect(trialDaysLeft(start, new Date('2026-11-01T20:00:00.000Z'))).toBe(TRIAL_DAYS);
  });

  it('counts down one per full day', () => {
    expect(trialDaysLeft(start, new Date('2026-11-04T09:00:00.000Z'))).toBe(TRIAL_DAYS - 3);
  });

  it('stops at zero once the trial has run out', () => {
    expect(trialDaysLeft(start, new Date('2026-12-20T09:00:00.000Z'))).toBe(0);
  });

  it('never exceeds the trial length when the clock is behind', () => {
    expect(trialDaysLeft(start, new Date('2026-10-01T09:00:00.000Z'))).toBe(TRIAL_DAYS);
  });

  it('treats a bad date as no trial left', () => {
    expect(trialDaysLeft('not a date')).toBe(0);
  });
});

describe('parsePlanChoice', () => {
  it('reads a stored trial', () => {
    const raw = JSON.stringify({ kind: 'trial', plan: 'pro', startedAt: '2026-11-01T08:00:00.000Z' });
    expect(parsePlanChoice(raw)).toEqual({ kind: 'trial', plan: 'pro', startedAt: '2026-11-01T08:00:00.000Z' });
  });

  it.each([null, '', 'garbage', '{"kind":"trial","plan":"gold","startedAt":"2026-11-01"}', '{"kind":"trial","plan":"pro"}'])(
    'falls back to free for %s',
    (raw) => {
      expect(parsePlanChoice(raw)).toEqual({ kind: 'free' });
    }
  );
});
