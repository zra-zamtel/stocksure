import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  collectSaleWarnings,
  expiryStatus,
  hasSaleWarnings,
  isExpired,
  isValidIsoDate,
  SALE_WARNING_AGE,
  SALE_WARNING_RX,
} from './product-fields';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidIsoDate('2026-11-27')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate(' 2027-01-01 ')).toBe(true);
  });

  it('refuses impossible days and other shapes', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('27/11/2026')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('1999-12-31')).toBe(false);
  });
});

describe('isExpired', () => {
  it('is expired only after the expiry day', () => {
    expect(isExpired('2026-11-26', '2026-11-27')).toBe(true);
    expect(isExpired('2026-11-27', '2026-11-27')).toBe(false);
    expect(isExpired('2026-12-01', '2026-11-27')).toBe(false);
  });

  it('ignores missing or broken dates', () => {
    expect(isExpired(undefined, '2026-11-27')).toBe(false);
    expect(isExpired(null, '2026-11-27')).toBe(false);
    expect(isExpired('soon', '2026-11-27')).toBe(false);
  });
});

describe('collectSaleWarnings', () => {
  const today = '2026-11-27';

  it('groups each line under the warnings it needs', () => {
    const warnings = collectSaleWarnings(
      [
        { label: 'Amoxil', saleWarning: SALE_WARNING_RX, expiryDate: '2026-10-01' },
        { label: 'Castle Lager', saleWarning: SALE_WARNING_AGE },
        { label: 'Lighter', saleWarning: 'Ask for ID' },
        { label: 'Bread', expiryDate: '2026-11-20' },
        { label: 'Shirt' },
      ],
      today
    );
    expect(warnings).toEqual({
      rx: ['Amoxil'],
      age: ['Castle Lager'],
      other: [{ label: 'Lighter', warning: 'Ask for ID' }],
      expired: ['Amoxil', 'Bread'],
    });
    expect(hasSaleWarnings(warnings)).toBe(true);
  });

  it('has nothing to say about an ordinary basket', () => {
    const warnings = collectSaleWarnings([{ label: 'Shirt', saleWarning: '  ', expiryDate: '2027-01-01' }], today);
    expect(hasSaleWarnings(warnings)).toBe(false);
  });
});

describe('expiryStatus', () => {
  const today = '2026-11-27';

  it('is expired after the day, soon within 30 days, ok beyond', () => {
    expect(expiryStatus('2026-11-26', today)).toBe('expired');
    expect(expiryStatus('2026-11-27', today)).toBe('soon');
    expect(expiryStatus('2026-12-27', today)).toBe('soon');
    expect(expiryStatus('2026-12-28', today)).toBe('ok');
    expect(expiryStatus('2026-12-01', today, 3)).toBe('ok');
  });

  it('has nothing to say without a usable date', () => {
    expect(expiryStatus(undefined, today)).toBeNull();
    expect(expiryStatus('2026-02-30', today)).toBeNull();
  });

  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });
});
