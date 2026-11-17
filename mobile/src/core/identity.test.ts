import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  isValidEmail,
  isValidPassword,
  isValidPhone,
  isValidPin,
  isValidResetCode,
  isValidTpin,
  normalisePhone,
  validateOwnerAccount,
  validatePinReset,
  validateStaffAccount,
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
  const valid = {
    name: 'Elton',
    phone: '097 123 4567',
    email: 'elton@example.com',
    password: 'correct horse battery',
    confirmPassword: 'correct horse battery',
    pin: '1234',
    confirmPin: '1234',
  };

  it('passes a complete account', () => {
    expect(validateOwnerAccount(valid)).toEqual([]);
  });

  it('reports every problem so the screen can show them together', () => {
    expect(
      validateOwnerAccount({
        name: '  ',
        phone: '123',
        email: 'not-an-email',
        password: 'short',
        confirmPassword: 'different',
        pin: '12',
        confirmPin: '12',
      })
    ).toEqual(['name-required', 'phone-invalid', 'email-invalid', 'password-invalid', 'pin-invalid']);
  });

  it('requires an email address and a long enough password', () => {
    expect(validateOwnerAccount({ ...valid, email: ' ' })).toEqual(['email-required']);
    expect(validateOwnerAccount({ ...valid, password: '1234567' })).toEqual(['password-invalid']);
    expect(validateOwnerAccount({ ...valid, confirmPassword: 'nope' })).toEqual(['password-mismatch']);
  });

  it('catches a mistyped confirmation PIN', () => {
    expect(validateOwnerAccount({ ...valid, confirmPin: '4321' })).toEqual(['pin-mismatch']);
  });
});

describe('email and password rules', () => {
  it('accepts a normal email and rejects a missing @ or domain dot', () => {
    expect(isValidEmail('elton@example.com')).toBe(true);
    expect(isValidEmail('elton@example')).toBe(false);
    expect(isValidEmail('elton.example.com')).toBe(false);
  });

  it('requires at least eight password characters', () => {
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('1234567')).toBe(false);
  });
});

describe('staff account validation', () => {
  const valid = { name: 'Given', phone: '096 555 1122', pin: '7315', confirmPin: '7315' };

  it('checks only the fields the owner fills in for staff', () => {
    expect(validateStaffAccount(valid)).toEqual([]);
    expect(validateStaffAccount({ ...valid, name: ' ' })).toEqual(['name-required']);
    expect(validateStaffAccount({ ...valid, pin: '12' })).toEqual(['pin-invalid']);
  });
});

describe('PIN reset validation', () => {
  const valid = { code: '123456', pin: '1234', confirmPin: '1234' };

  it('accepts a six-digit code and a matching PIN', () => {
    expect(isValidResetCode('123456')).toBe(true);
    expect(isValidResetCode('12345')).toBe(false);
    expect(isValidResetCode('12a456')).toBe(false);
    expect(validatePinReset(valid)).toEqual([]);
  });

  it('reports a bad code, bad PIN or mismatched confirmation', () => {
    expect(validatePinReset({ ...valid, code: '123' })).toEqual(['code-invalid']);
    expect(validatePinReset({ ...valid, pin: '12' })).toEqual(['pin-invalid']);
    expect(validatePinReset({ ...valid, confirmPin: '4321' })).toEqual(['pin-mismatch']);
  });
});

describe('TPIN', () => {
  it('rejects a supplied value of the wrong shape; the screen treats blank as skipped', () => {
    expect(isValidTpin('')).toBe(false);
    expect(isValidTpin('1001234567')).toBe(true);
    expect(isValidTpin('100123')).toBe(false);
  });
});
