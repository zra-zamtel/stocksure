export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/**
 * Applies one key to a kwacha amount typed as text. Every rule here keeps the
 * text in a shape parsePrice accepts, so the parent never has to validate a
 * half-typed amount, and the cashier simply cannot type a bad one.
 */
export function pressKey(text: string, key: KeypadKey, maxWhole = 7): string {
  if (key === 'back') return text.slice(0, -1);

  const dot = text.indexOf('.');

  if (key === '.') {
    if (dot !== -1) return text;
    return text === '' ? '0.' : `${text}.`;
  }

  if (dot !== -1) return text.length - dot - 1 >= 2 ? text : text + key;
  // A lone "0" is replaced, not extended, so "05" and "00" never appear.
  if (text === '0') return key;
  return text.length >= maxWhole ? text : text + key;
}
