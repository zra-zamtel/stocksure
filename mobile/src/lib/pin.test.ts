import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// expo-crypto is native; stand in Node's crypto with the same contract.
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, data: string) =>
    createHash('sha256').update(data).digest('hex'),
  getRandomBytes: (size: number) => new Uint8Array(randomBytes(size)),
}));

const { hashPin, verifyPin } = await import('./pin');

// Copied from backend/apps/accounts/serializers.py: the server rejects anything else.
const BACKEND_PIN_HASH = /^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/i;

describe('UT-PIN PIN hashing', () => {
  it('UT-PIN-01 never stores the PIN itself', async () => {
    const stored = await hashPin('4821');
    expect(stored).not.toContain('4821');
  });

  it('UT-PIN-02 produces the format the backend accepts', async () => {
    expect(await hashPin('4821')).toMatch(BACKEND_PIN_HASH);
  });

  it('UT-PIN-03 salts each hash, so one PIN gives different hashes', async () => {
    expect(await hashPin('4821')).not.toBe(await hashPin('4821'));
  });

  it('UT-PIN-04 verifies the right PIN and rejects a wrong one', async () => {
    const stored = await hashPin('4821');
    expect(await verifyPin('4821', stored)).toBe(true);
    expect(await verifyPin('4822', stored)).toBe(false);
    expect(await verifyPin('', stored)).toBe(false);
  });

  it('UT-PIN-05 rejects a malformed or foreign stored hash', async () => {
    expect(await verifyPin('4821', '4821')).toBe(false);
    expect(await verifyPin('4821', 'md5$abc$def')).toBe(false);
    expect(await verifyPin('4821', 'sha256$$')).toBe(false);
  });
});
