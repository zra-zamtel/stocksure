/**
 * Account and onboarding validation. These rules are shared by the screens and
 * the session layer, and they are framework-free so they can move to
 * `packages/core` later.
 */

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 6;

export type AccountErrorCode =
  | 'name-required'
  | 'phone-invalid'
  | 'pin-invalid'
  | 'pin-mismatch';

/**
 * Zambian numbers are written as 097 123 4567, +260 97 123 4567 or 260971234567.
 * Store them in the local 10-digit form so two spellings of one number cannot
 * create two accounts.
 */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+260')) return `0${digits.slice(3)}`;
  if (digits.startsWith('260') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('00260')) return `0${digits.slice(5)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

/** Permissive on purpose: a shop phone can be any Zambian number, not only mobile. */
export function isValidPhone(phone: string): boolean {
  return /^0\d{9}$/.test(normalisePhone(phone));
}

export function normalisePin(pin: string): string {
  return pin.replace(/\D/g, '');
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${MIN_PIN_LENGTH},${MAX_PIN_LENGTH}}$`).test(pin);
}

export function validateOwnerAccount(input: {
  name: string;
  phone: string;
  pin: string;
  confirmPin: string;
}): AccountErrorCode[] {
  const errors: AccountErrorCode[] = [];
  if (!input.name.trim()) errors.push('name-required');
  if (!isValidPhone(input.phone)) errors.push('phone-invalid');
  if (!isValidPin(input.pin)) errors.push('pin-invalid');
  else if (input.pin !== input.confirmPin) errors.push('pin-mismatch');
  return errors;
}

/** Display-only grouping, never used as the stored value. */
export function formatPhone(phone: string): string {
  const normalised = normalisePhone(phone);
  if (!/^0\d{9}$/.test(normalised)) return phone.trim();
  return `${normalised.slice(0, 3)} ${normalised.slice(3, 6)} ${normalised.slice(6)}`;
}

/** A TPIN is optional, but when supplied it should look like ZRA's 10 digits. */
export function isValidTpin(tpin: string): boolean {
  return /^\d{10}$/.test(tpin.trim());
}
