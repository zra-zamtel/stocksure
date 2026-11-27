import { describe, expect, it } from 'vitest';
import { formatCount, formatDateTime, formatDay, formatKwacha, formatTime, localDayKey } from './format';

describe('UT-FMT formatting', () => {
  it('UT-FMT-01 shows ngwee as kwacha with two decimals', () => {
    expect(formatKwacha(123456)).toBe('K 1,234.56');
    expect(formatKwacha(5)).toBe('K 0.05');
    expect(formatKwacha(0)).toBe('K 0.00');
  });

  it('UT-FMT-02 puts the minus sign before the currency', () => {
    expect(formatKwacha(-2500)).toBe('-K 25.00');
  });

  it('UT-FMT-03 groups thousands in counts', () => {
    expect(formatCount(12000)).toBe('12,000');
  });

  it('UT-FMT-04 writes dates day/month/year everywhere', () => {
    expect(formatDay('2026-11-25')).toBe('25/11/2026');
    const local = new Date(2026, 10, 21, 14, 5).toISOString();
    expect(formatDay(local)).toBe('21/11/2026');
    expect(formatTime(local)).toBe('14:05');
    expect(formatDateTime(local)).toBe('21/11/2026 14:05');
  });

  it('UT-FMT-05 groups by the local calendar day', () => {
    expect(localDayKey(new Date(2026, 10, 21, 23, 59).toISOString())).toBe('2026-11-21');
    expect(localDayKey(new Date(2026, 10, 22, 0, 1).toISOString())).toBe('2026-11-22');
    expect(localDayKey('2026-01-05')).toBe('2026-01-05');
  });
});
