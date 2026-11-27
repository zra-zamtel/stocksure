import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: '192.168.1.20:8081' } },
}));

const { pullSync, pushSync, refreshDeviceTokenOnServer } = await import('./api');

function respond(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UT-SYNC API client', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('UT-SYNC-01 posts the outbox to the sync push endpoint', async () => {
    const fetchMock = respond(200, {
      accepted: ['q1'],
      rejected: [],
      serverTime: '2026-11-18T08:00:00Z',
      cursor: '12',
    });
    const changes = [
      {
        queueId: 'q1',
        entity: 'sale',
        entityId: 'sale_1',
        operation: 'create' as const,
        payload: { total: 45000 },
      },
    ];

    const result = await pushSync({
      deviceId: 'dev_1',
      batchId: 'batch_1',
      changes,
      accessToken: 'jwt',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/sync/push');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body as string)).toEqual({
      deviceId: 'dev_1',
      batchId: 'batch_1',
      changes,
    });
    expect(result.accepted).toEqual(['q1']);
  });

  it('UT-SYNC-02 pulls with the cursor and limit', async () => {
    const fetchMock = respond(200, {
      changes: [],
      nextCursor: '12',
      serverTime: '2026-11-18T08:00:00Z',
    });

    await pullSync({ accessToken: 'jwt', cursor: '11', limit: 100 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/sync/pull?cursor=11&limit=100');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('UT-SYNC-03 reports an oversized or malformed batch as validation', async () => {
    respond(400, { detail: 'Send at most 500 changes per batch.' });

    await expect(
      pushSync({ deviceId: 'dev_1', batchId: 'batch_1', changes: [], accessToken: 'jwt' })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Send at most 500 changes per batch.',
    });
  });

  it('UT-SYNC-REFRESH-01 swaps the refresh key for a new device key', async () => {
    const fetchMock = respond(200, { access: 'new-access', refresh: 'new-refresh' });
    await expect(refreshDeviceTokenOnServer('old-refresh')).resolves.toEqual({
      access: 'new-access',
      refresh: 'new-refresh',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/refresh/');
    expect(JSON.parse(String(init.body))).toEqual({ refresh: 'old-refresh' });
  });

  it('UT-SYNC-REFRESH-02 keeps the old refresh key when the server does not rotate it', async () => {
    respond(200, { access: 'new-access' });
    await expect(refreshDeviceTokenOnServer('old-refresh')).resolves.toEqual({
      access: 'new-access',
      refresh: 'old-refresh',
    });
  });

  it('UT-SYNC-REFRESH-03 reports an expired refresh key as unauthorized, not as raw server text', async () => {
    respond(401, { detail: 'Token is invalid or expired', code: 'token_not_valid' });
    await expect(refreshDeviceTokenOnServer('old-refresh')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Your session has expired.',
    });
  });
});
