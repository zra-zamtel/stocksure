import { describe, expect, it } from 'vitest';
import { formatCount, formatKwacha } from './format';

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
});
