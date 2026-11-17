import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from './api';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: '192.168.1.20:8081' } } }));

const { API_BASE_URL, registerOwnerOnServer } = await import('./api');

const request = {
  id: 'owner_1',
  name: 'Elton',
  phone: '0971234567',
  pinHash: 'sha256$' + 'a'.repeat(32) + '$' + 'b'.repeat(64),
};

function respond(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failure(): Promise<ApiError> {
  try {
    await registerOwnerOnServer(request);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected registerOwnerOnServer to fail');
}

describe('UT-API owner registration client', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('UT-API-01 points at the Expo host on port 8000 during development', () => {
    expect(API_BASE_URL).toBe('http://192.168.1.20:8000');
  });

  it('UT-API-02 posts the owner as JSON to the register endpoint', async () => {
    const fetchMock = respond(201, { id: 'owner_1' });
    await registerOwnerOnServer(request);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('UT-API-03 treats a retry answered with 200 as success', async () => {
    respond(200, { id: 'owner_1' });
    await expect(registerOwnerOnServer(request)).resolves.toBeUndefined();
  });

  it('UT-API-04 maps a taken phone to duplicate-phone', async () => {
    respond(409, { code: 'phone_taken', detail: 'That phone number is already registered.' });
    expect((await failure()).code).toBe('duplicate-phone');
  });

  it('UT-API-05 does not call an id conflict a duplicate phone', async () => {
    respond(409, { code: 'id_conflict', detail: 'x' });
    expect((await failure()).code).toBe('server');
  });

  it('UT-API-06 maps 400 to validation', async () => {
    respond(400, { phone: ['bad'] });
    expect((await failure()).code).toBe('validation');
  });

  it('UT-API-07 copes with a server error that is not JSON', async () => {
    respond(500);
    const error = await failure();
    expect(error.code).toBe('server');
    expect(error.message).toBeTruthy();
  });

  it('UT-API-08 reports no connection as offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Network request failed'))));
    expect((await failure()).code).toBe('offline');
  });
});
