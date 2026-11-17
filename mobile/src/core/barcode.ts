/**
 * EAN-13 encoding, done in plain TypeScript so a label can be drawn with Views
 * and no barcode library. EAN-13 is what retail scanners expect, and the leading
 * digit 2 is the GS1 range reserved for codes a shop makes for itself, so an
 * in-store label can never collide with a manufacturer's GTIN.
 */

const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

// Parity of the six left-hand digits, chosen by the first digit of the code.
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

// GS1 20: restricted circulation for a shop's own items. 21-29 are commonly
// read by tills and scales as variable-weight codes with a price embedded.
export const IN_STORE_PREFIX = '20';

export function ean13CheckDigit(firstTwelve: string): number {
  if (!/^\d{12}$/.test(firstTwelve)) {
    throw new Error('EAN-13 needs twelve digits before the check digit');
  }
  const sum = firstTwelve
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{13}$/.test(digits)) return false;
  return ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12]);
}

/** Returns 95 modules of '1' (bar) and '0' (space), quiet zones excluded. */
export function encodeEan13(code: string): string {
  const digits = code.replace(/\s+/g, '');
  if (!isValidEan13(digits)) throw new Error('Not a valid EAN-13 barcode');

  const parity = PARITY[Number(digits[0])];
  let bits = '101';
  for (let index = 1; index <= 6; index += 1) {
    const digit = Number(digits[index]);
    bits += parity[index - 1] === 'L' ? L[digit] : G[digit];
  }
  bits += '01010';
  for (let index = 7; index <= 12; index += 1) {
    bits += R[Number(digits[index])];
  }
  return `${bits}101`;
}

export function generateInStoreBarcode(random: () => number = Math.random): string {
  let body = IN_STORE_PREFIX;
  while (body.length < 12) {
    body += Math.floor(random() * 10);
  }
  return `${body}${ean13CheckDigit(body)}`;
}

export function isInStoreBarcode(code: string): boolean {
  return code.startsWith(IN_STORE_PREFIX) && isValidEan13(code);
}

/**
 * Scanners report the same physical code as 12-digit UPC-A or 13-digit EAN-13
 * depending on the device, so a lookup must treat those as the same product.
 */
export function normaliseBarcode(code: string): string {
  const compact = code.trim().replace(/\s+/g, '');
  if (/^\d{12}$/.test(compact)) return `0${compact}`;
  return compact;
}
