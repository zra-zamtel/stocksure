import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  isValidPhone,
  isValidPin,
  isValidTpin,
  normalisePhone,
  validateOwnerAccount,
} from './identity';

describe('phone numbers', () => {
  it('stores common Zambian spellings in one local form', () => {
    expect(normalisePhone('097 123 4567')).toBe('0971234567');
    expect(normalisePhone('+260 97 123 4567')).toBe('0971234567');
    expect(normalisePhone('260971234567')).toBe('0971234567');
    expect(normalisePhone('00260971234567')).toBe('0971234567');
    expect(normalisePhone('971234567')).toBe('0971234567');
  });

  it('accepts a ten-digit local number and rejects short or empty input', () => {
    expect(isValidPhone('0971234567')).toBe(true);
    expect(isValidPhone('097 123 4567')).toBe(true);
    expect(isValidPhone('09712345')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });

  it('groups a stored number for display only', () => {
    expect(formatPhone('0971234567')).toBe('097 123 4567');
    expect(formatPhone('not a number')).toBe('not a number');
  });
});

describe('PIN rules', () => {
  it('accepts 4 to 6 digits and nothing else', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});

describe('owner account validation', () => {
  const valid = { name: 'Elton', phone: '097 123 4567', pin: '1234', confirmPin: '1234' };

  it('passes a complete account', () => {
    expect(validateOwnerAccount(valid)).toEqual([]);
  });

  it('reports every problem so the screen can show them together', () => {
    expect(
      validateOwnerAccount({ name: '  ', phone: '123', pin: '12', confirmPin: '12' })
    ).toEqual(['name-required', 'phone-invalid', 'pin-invalid']);
  });

  it('catches a mistyped confirmation PIN', () => {
    expect(validateOwnerAccount({ ...valid, confirmPin: '4321' })).toEqual(['pin-mismatch']);
  });
});

describe('TPIN', () => {
  it('rejects a supplied value of the wrong shape; the screen treats blank as skipped', () => {
    expect(isValidTpin('')).toBe(false);
    expect(isValidTpin('1001234567')).toBe(true);
    expect(isValidTpin('100123')).toBe(false);
  });
});
