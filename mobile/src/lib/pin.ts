import * as Crypto from 'expo-crypto';

/**
 * The PIN never leaves the phone. It is salted and hashed before it reaches the
 * owner row, so a copied database does not expose the code the owner types.
 *
 * Format: `sha256$<salt-hex>$<digest-hex>`. The prefix leaves room to move to a
 * slower key-derivation function later without a schema change.
 */
const PREFIX = 'sha256';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(salt: string, pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = toHex(Crypto.getRandomBytes(16));
  return `${PREFIX}$${salt}$${await digest(salt, pin)}`;
}

/** Timing-safe enough for a local unlock: never short-circuit on the first byte. */
function equalHashes(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [prefix, salt, expected] = stored.split('$');
  if (prefix !== PREFIX || !salt || !expected) return false;
  return equalHashes(await digest(salt, pin), expected);
}
