import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from './api';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: '192.168.1.20:8081' } } }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, data: string) =>
    createHash('sha256').update(data).digest('hex'),
  getRandomBytes: (size: number) => new Uint8Array(randomBytes(size)),
}));

const {
  API_BASE_URL,
  confirmPinResetOnServer,
  confirmStaffSignInOnServer,
  loginOwnerOnServer,
  paymentRequestStatusOnServer,
  requestToPayOnServer,
  registerOwnerOnServer,
  registerStaffOnServer,
  requestEmailCodeOnServer,
  requestPasswordResetOnServer,
  confirmPasswordResetOnServer,
  resetStaffPinOnServer,
  requestPinResetOnServer,
  setOwnerDevicePinOnServer,
  verifyEmailCodeOnServer,
  verifyStaffSignInOnServer,
} = await import('./api');

const request = {
  id: 'owner_1',
  name: 'Elton',
  phone: '0971234567',
  email: 'elton@example.com',
  password: 'correct horse battery',
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
    const fetchMock = respond(201, {
      owner: { id: 'owner_1', name: 'Elton', phone: '0971234567', email: 'elton@example.com' },
      deviceToken: 'device-token',
    });
    await registerOwnerOnServer(request);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('UT-API-03 treats a retry answered with 200 as success', async () => {
    respond(200, {
      owner: { id: 'owner_1', name: 'Elton', phone: '0971234567', email: 'elton@example.com' },
      deviceToken: 'device-token',
    });
    await expect(registerOwnerOnServer(request)).resolves.toMatchObject({
      deviceToken: 'device-token',
    });
  });

  it('UT-API-04 maps a taken phone to duplicate-phone', async () => {
    respond(409, { code: 'phone_taken', detail: 'That phone number is already registered.' });
    expect((await failure()).code).toBe('duplicate-phone');
  });

  it('UT-API-04b maps a taken email to duplicate-email', async () => {
    respond(409, { code: 'email_taken', detail: 'That email address is already registered.' });
    expect((await failure()).code).toBe('duplicate-email');
  });

  it('UT-API-04c maps a conflicting retry to account-conflict', async () => {
    respond(409, { code: 'account_conflict' });
    expect((await failure()).code).toBe('account-conflict');
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

async function resetFailure(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the reset call to fail');
}

describe('UT-API PIN reset client', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('UT-API-09 requests a code and returns the demo code', async () => {
    const fetchMock = respond(200, { expiresAt: '2026-11-17T10:00:00Z', demoCode: '123456' });

    const result = await requestPinResetOnServer('0971234567');

    expect(result).toEqual({ expiresAt: '2026-11-17T10:00:00Z', demoCode: '123456' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/pin-reset/request');
    expect(JSON.parse(init.body as string)).toEqual({ phone: '0971234567' });
  });

  it('UT-API-10 posts the code and new PIN hash to confirm', async () => {
    const fetchMock = respond(200, { id: 'owner_1' });

    await confirmPinResetOnServer({
      phone: '0971234567',
      code: '123456',
      pinHash: request.pinHash,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/pin-reset/confirm');
    expect(JSON.parse(init.body as string)).toEqual({
      phone: '0971234567',
      code: '123456',
      pinHash: request.pinHash,
    });
  });

  it('UT-API-11 maps an unknown phone on request', async () => {
    respond(404, { code: 'phone_not_found' });

    const error = await resetFailure(() => requestPinResetOnServer('0971234567'));

    expect(error.code).toBe('phone-not-found');
  });

  it('UT-API-12 maps an invalid code', async () => {
    respond(400, { code: 'invalid_code', detail: 'That code is not correct.' });

    const error = await resetFailure(() =>
      confirmPinResetOnServer({ phone: '0971234567', code: '000000', pinHash: request.pinHash })
    );

    expect(error.code).toBe('invalid-code');
  });

  it('UT-API-13 maps an expired code', async () => {
    respond(410, { code: 'expired_code' });

    const error = await resetFailure(() =>
      confirmPinResetOnServer({ phone: '0971234567', code: '123456', pinHash: request.pinHash })
    );

    expect(error.code).toBe('expired-code');
  });

  it('UT-API-14 maps too many attempts', async () => {
    respond(429, { code: 'too_many_attempts' });

    const error = await resetFailure(() =>
      confirmPinResetOnServer({ phone: '0971234567', code: '123456', pinHash: request.pinHash })
    );

    expect(error.code).toBe('too-many-attempts');
  });

  it('UT-API-15 maps a field error on confirm to validation', async () => {
    respond(400, { pinHash: ['bad'] });

    const error = await resetFailure(() =>
      confirmPinResetOnServer({ phone: '0971234567', code: '123456', pinHash: 'bad' })
    );

    expect(error.code).toBe('validation');
  });
});

const sessionPayload = {
  owner: { id: 'owner_1', name: 'Elton', phone: '0971234567', email: 'elton@example.com' },
  deviceToken: 'device-token',
};

async function authFailure(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the auth call to fail');
}

describe('UT-API owner email client', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('UT-API-16 posts email and password to login', async () => {
    const fetchMock = respond(200, sessionPayload);

    const result = await loginOwnerOnServer({
      email: 'elton@example.com',
      password: 'correct horse battery',
    });

    expect(result.deviceToken).toBe('device-token');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'elton@example.com',
      password: 'correct horse battery',
    });
  });

  it('UT-API-17 maps wrong credentials', async () => {
    respond(401, { code: 'invalid_credentials' });
    const error = await authFailure(() =>
      loginOwnerOnServer({ email: 'elton@example.com', password: 'wrong' })
    );
    expect(error.code).toBe('invalid-credentials');
  });

  it('UT-API-17b maps an unverified email to email-unverified', async () => {
    respond(403, { code: 'email_unverified' });
    const error = await authFailure(() =>
      loginOwnerOnServer({ email: 'elton@example.com', password: 'correct horse battery' })
    );
    expect(error.code).toBe('email-unverified');
  });

  it('UT-API-17c passes on that the server emailed a confirmation code', async () => {
    respond(403, { code: 'email_unverified', verificationSent: true, demoCode: '123456' });
    const error = await authFailure(() =>
      loginOwnerOnServer({ email: 'elton@example.com', password: 'correct horse battery' })
    );
    expect(error.code).toBe('email-unverified');
    expect(error.details).toEqual({ verificationSent: true, demoCode: '123456' });
  });

  it('UT-API-18 requests a confirmation code and returns the demo code', async () => {
    const fetchMock = respond(200, { expiresAt: '2026-11-17T10:15:00Z', demoCode: '123456' });

    const result = await requestEmailCodeOnServer('elton@example.com', '0971234567');

    expect(result.demoCode).toBe('123456');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/email-code/request');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'elton@example.com',
      phone: '0971234567',
    });
  });

  it('UT-API-19 verifies an email code into a device session', async () => {
    const fetchMock = respond(200, sessionPayload);

    const result = await verifyEmailCodeOnServer('elton@example.com', '123456');

    expect(result.owner.email).toBe('elton@example.com');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/email-code/verify');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'elton@example.com', code: '123456' });
  });

  it('UT-API-20 maps wrong, expired and exhausted codes', async () => {
    respond(400, { code: 'invalid_code' });
    expect((await authFailure(() => verifyEmailCodeOnServer('e@x.com', '000000'))).code).toBe('invalid-code');

    respond(410, { code: 'expired_code' });
    expect((await authFailure(() => verifyEmailCodeOnServer('e@x.com', '000000'))).code).toBe('expired-code');

    respond(429, { code: 'too_many_attempts' });
    expect((await authFailure(() => verifyEmailCodeOnServer('e@x.com', '000000'))).code).toBe(
      'too-many-attempts'
    );
  });

  it('UT-API-20b resets the password with an emailed code', async () => {
    const fetchMock = respond(200, { expiresAt: '2026-11-17T10:15:00Z' });
    await requestPasswordResetOnServer('elton@example.com');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://192.168.1.20:8000/api/v1/auth/password-reset/request'
    );

    const confirmMock = respond(200, sessionPayload);
    const result = await confirmPasswordResetOnServer({
      email: 'elton@example.com',
      code: '123456',
      password: 'a brand new pass',
    });
    expect(result.owner.email).toBe('elton@example.com');
    expect((confirmMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://192.168.1.20:8000/api/v1/auth/password-reset/confirm'
    );
  });

  it('UT-API-21 sets the device PIN with the bearer token', async () => {
    const fetchMock = respond(200, { id: 'owner_1' });

    await setOwnerDevicePinOnServer({ deviceToken: 'device-token', pinHash: request.pinHash });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/device-pin');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-token');
    expect(JSON.parse(init.body as string)).toEqual({ pinHash: request.pinHash });
  });
});

const staff = {
  id: 'staff_1',
  ownerId: 'owner_1',
  name: 'Given',
  phone: '0965551122',
  pin: '7315',
  deviceToken: 'owner-device-token',
};

async function staffFailure(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the staff call to fail');
}

describe('UT-API staff identity client', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('UT-API-22 registers staff under the owner', async () => {
    const fetchMock = respond(201, { id: 'staff_1', name: 'Given', phone: '0965551122', role: 'staff' });

    const created = await registerStaffOnServer(staff);

    expect(created).toEqual({ id: 'staff_1', name: 'Given', phone: '0965551122', role: 'staff' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/staff');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer owner-device-token'
    );
    const { deviceToken: _token, ...body } = staff;
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('UT-API-23 maps a duplicate staff phone', async () => {
    respond(409, { code: 'phone_taken' });

    const error = await staffFailure(() => registerStaffOnServer(staff));

    expect(error.code).toBe('duplicate-phone');
  });

  it('UT-API-24 maps a missing owner token and a mismatched owner', async () => {
    respond(401, { code: 'unauthorized' });
    expect((await staffFailure(() => registerStaffOnServer(staff))).code).toBe('unauthorized');

    respond(403, { code: 'forbidden' });
    expect((await staffFailure(() => registerStaffOnServer(staff))).code).toBe('forbidden');
  });

  it('UT-API-25 sends the first-sign-in PIN once and returns the staff record', async () => {
    const fetchMock = respond(200, {
      staff: { id: 'staff_1', name: 'Given', phone: '0965551122', role: 'staff' },
      owner: { name: 'Elton', phone: '0971234567' },
    });

    const result = await verifyStaffSignInOnServer('0965551122', '7315');

    expect(result.staff.role).toBe('staff');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/staff-sign-in/confirm');
    expect(JSON.parse(init.body as string)).toEqual({ phone: '0965551122', pin: '7315' });
  });

  it('UT-API-25b sends the staff member\'s own PIN on the second step', async () => {
    const fetchMock = respond(200, {
      staff: { id: 'staff_1', name: 'Given', phone: '0965551122', role: 'staff' },
      owner: { name: 'Elton', phone: '0971234567' },
      mustChangePin: false,
    });

    const result = await verifyStaffSignInOnServer('0965551122', '7315', '8642');

    expect(result.mustChangePin).toBe(false);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ phone: '0965551122', pin: '7315', newPin: '8642' });
  });

  it('UT-API-26 maps a wrong PIN and a lockout', async () => {
    respond(401, { code: 'invalid_credentials' });
    expect(
      (await staffFailure(() => confirmStaffSignInOnServer({ phone: '0965551122', pin: '0000' })))
        .code
    ).toBe('unauthorized');

    respond(429, { code: 'too_many_attempts' });
    expect(
      (await staffFailure(() => confirmStaffSignInOnServer({ phone: '0965551122', pin: '0000' })))
        .code
    ).toBe('too-many-attempts');
  });

  it('UT-API-27 resets a staff PIN with the owner token', async () => {
    const fetchMock = respond(200, {
      id: 'staff_1',
      name: 'Given',
      phone: '0965551122',
      role: 'staff',
    });

    const result = await resetStaffPinOnServer({
      staffId: 'staff_1',
      pin: '9042',
      deviceToken: 'owner-device-token',
    });

    expect(result.id).toBe('staff_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8000/api/v1/auth/staff/staff_1/pin-reset');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer owner-device-token'
    );
    expect(JSON.parse(init.body as string)).toEqual({ pin: '9042' });
  });

  it('UT-API-28 maps staff reset failures', async () => {
    const reset = () =>
      resetStaffPinOnServer({
        staffId: 'staff_1',
        pin: '9042',
        deviceToken: 'owner-device-token',
      });

    respond(401, { code: 'unauthorized' });
    expect((await staffFailure(reset)).code).toBe('unauthorized');

    respond(403, { code: 'forbidden' });
    expect((await staffFailure(reset)).code).toBe('forbidden');

    respond(404, { code: 'staff_not_found' });
    expect((await staffFailure(reset)).code).toBe('staff-not-found');
  });
});

describe('request to pay', () => {
  const pending = {
    id: 'rtp_abc12345',
    provider: 'MTN',
    phone: '260971234567',
    amount: 25000,
    status: 'pending',
    reference: '',
    reason: '',
    createdAt: '2026-11-21T10:00:00Z',
    completedAt: null,
  };

  it('UT-API-RTP-01 sends the request with the device token and returns it', async () => {
    const fetchMock = respond(201, pending);
    const result = await requestToPayOnServer({
      id: 'rtp_abc12345',
      provider: 'MTN',
      phone: '0971234567',
      amount: 25000,
      deviceToken: 'tok',
    });
    expect(result.status).toBe('pending');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/collections\/request-to-pay$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      id: 'rtp_abc12345',
      provider: 'MTN',
      phone: '0971234567',
      amount: 25000,
    });
  });

  it('UT-API-RTP-02 polls the status by id', async () => {
    const fetchMock = respond(200, { ...pending, status: 'successful', reference: 'MPSIM1A2B' });
    const result = await paymentRequestStatusOnServer({ id: 'rtp_abc12345', deviceToken: 'tok' });
    expect(result.reference).toBe('MPSIM1A2B');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/request-to-pay\/rtp_abc12345$/);
  });

  it('UT-API-RTP-03 maps a bad phone or amount to validation', async () => {
    respond(400, { detail: 'Enter a valid Zambian phone number.' });
    await expect(
      requestToPayOnServer({ id: 'rtp_x1234567', provider: 'MTN', phone: '1', amount: 1, deviceToken: 'tok' })
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
