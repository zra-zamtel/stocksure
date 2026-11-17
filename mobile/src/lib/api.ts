import Constants from 'expo-constants';
import { Platform } from 'react-native';

const REGISTER_PATH = '/api/v1/auth/register';
const LOGIN_PATH = '/api/v1/auth/login';
const MAGIC_LINK_REQUEST_PATH = '/api/v1/auth/magic-link/request';
const MAGIC_LINK_VERIFY_PATH = '/api/v1/auth/magic-link/verify';
const DEVICE_PIN_PATH = '/api/v1/auth/device-pin';
const PIN_RESET_REQUEST_PATH = '/api/v1/auth/pin-reset/request';
const PIN_RESET_CONFIRM_PATH = '/api/v1/auth/pin-reset/confirm';
const STAFF_REGISTER_PATH = '/api/v1/staff';
const STAFF_SIGN_IN_CONFIRM_PATH = '/api/v1/auth/staff-sign-in/confirm';
const TIMEOUT_MS = 12_000;

type RegisterOwnerRequest = {
  id: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  pinHash: string;
};

export type ServerOwner = {
  id: string;
  name: string;
  phone: string;
  email?: string;
};

export type OwnerSession = {
  owner: ServerOwner;
  deviceToken: string;
};

export type ApiErrorCode =
  | 'offline'
  | 'duplicate-phone'
  | 'duplicate-email'
  | 'account-conflict'
  | 'phone-not-found'
  | 'owner-not-found'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-credentials'
  | 'invalid-token'
  | 'expired-token'
  | 'invalid-code'
  | 'expired-code'
  | 'too-many-attempts'
  | 'validation'
  | 'server';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function configuredBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : null;
}

/**
 * During development the backend runs on the same machine as Expo. The Expo
 * host is therefore the address the phone can already reach. An explicit
 * EXPO_PUBLIC_API_URL wins, which is what a deployed backend uses.
 */
function developmentBaseUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  let host = hostUri?.split(':')[0] ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');

  // localhost inside the Android emulator is the emulator, not the dev machine.
  if (Platform.OS === 'android' && (host === 'localhost' || host === '127.0.0.1')) {
    host = '10.0.2.2';
  }

  return `http://${host}:8000`;
}

export const API_BASE_URL = configuredBaseUrl() ?? developmentBaseUrl();

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // A refusal, a timeout and no signal all mean the same thing to the owner.
    throw new ApiError('offline', 'Could not reach the account service');
  } finally {
    clearTimeout(timer);
  }
}

type ErrorPayload = { code?: string; detail?: string };

async function readErrorPayload(response: Response): Promise<ErrorPayload | null> {
  try {
    return (await response.json()) as ErrorPayload;
  } catch {
    return null;
  }
}

/** The one online call in account creation: register before caching locally. */
export async function registerOwnerOnServer(
  input: RegisterOwnerRequest
): Promise<OwnerSession> {
  const response = await postJson(REGISTER_PATH, input);
  if (response.ok) return (await response.json()) as OwnerSession;

  const payload = await readErrorPayload(response);
  if (response.status === 409 && payload?.code === 'phone_taken') {
    throw new ApiError(
      'duplicate-phone',
      payload.detail ?? 'That phone number is already registered.'
    );
  }
  if (response.status === 409 && payload?.code === 'email_taken') {
    throw new ApiError(
      'duplicate-email',
      payload.detail ?? 'That email address is already registered.'
    );
  }
  if (response.status === 409 && payload?.code === 'account_conflict') {
    throw new ApiError(
      'account-conflict',
      payload.detail ?? 'An account already exists for this ID. Sign in with email instead.'
    );
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the account details and try again.');
  }
  throw new ApiError(
    'server',
    payload?.detail ?? 'The account service could not register this owner.'
  );
}

/** Email + password sign-in on a new phone or after a forgotten PIN. */
export async function loginOwnerOnServer(input: {
  email: string;
  password: string;
}): Promise<OwnerSession> {
  const response = await postJson(LOGIN_PATH, input);
  if (response.ok) return (await response.json()) as OwnerSession;

  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('invalid-credentials', payload?.detail ?? 'That email and password do not match.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the email address and password.');
  }
  throw new ApiError('server', payload?.detail ?? 'The sign-in service could not be reached.');
}

export type MagicLinkRequestResult = {
  expiresAt: string;
  demoToken?: string;
  demoUrl?: string;
};

/** Ask for a single-use email link. The response is generic for unknown emails. */
export async function requestMagicLinkOnServer(email: string): Promise<MagicLinkRequestResult> {
  const response = await postJson(MAGIC_LINK_REQUEST_PATH, { email });
  if (response.ok) {
    const payload = (await response.json()) as Partial<MagicLinkRequestResult>;
    return {
      expiresAt: payload.expiresAt ?? '',
      demoToken: payload.demoToken,
      demoUrl: payload.demoUrl,
    };
  }

  const payload = await readErrorPayload(response);
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the email address.');
  }
  throw new ApiError('server', payload?.detail ?? 'The link service could not send an email.');
}

/** Verify a magic link and receive a device token for this phone. */
export async function verifyMagicLinkOnServer(token: string): Promise<OwnerSession> {
  const response = await postJson(MAGIC_LINK_VERIFY_PATH, { token });
  if (response.ok) return (await response.json()) as OwnerSession;

  const payload = await readErrorPayload(response);
  if (response.status === 400 && payload?.code === 'invalid_token') {
    throw new ApiError('invalid-token', payload?.detail ?? 'That sign-in link is not valid.');
  }
  if (response.status === 410) {
    throw new ApiError('expired-token', payload?.detail ?? 'That sign-in link has expired.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'That sign-in link is not valid.');
  }
  throw new ApiError('server', payload?.detail ?? 'The link service could not sign you in.');
}

/** Store the local PIN hash on the server against a verified device session. */
export async function setOwnerDevicePinOnServer(input: {
  deviceToken: string;
  pinHash: string;
}): Promise<void> {
  const response = await postJson(
    DEVICE_PIN_PATH,
    { pinHash: input.pinHash },
    { Authorization: `Bearer ${input.deviceToken}` }
  );
  if (response.ok) return;

  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'Sign in again to set the phone PIN.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the PIN and try again.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not save the phone PIN.');
}

export type PinResetRequestResult = {
  expiresAt: string;
  demoCode?: string;
};

/** Ask the backend for a reset code. This always needs a connection. */
export async function requestPinResetOnServer(phone: string): Promise<PinResetRequestResult> {
  const response = await postJson(PIN_RESET_REQUEST_PATH, { phone });
  if (response.ok) {
    const payload = (await response.json()) as { expiresAt?: string; demoCode?: string };
    return { expiresAt: payload.expiresAt ?? '', demoCode: payload.demoCode };
  }

  const payload = await readErrorPayload(response);
  if (response.status === 404) {
    throw new ApiError('phone-not-found', payload?.detail ?? 'That phone number is not registered.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the phone number and try again.');
  }
  throw new ApiError(
    'server',
    payload?.detail ?? 'The reset service could not send a code.'
  );
}

/**
 * Send the code and a freshly salted PIN hash. The server replaces its copy and
 * the phone stores the same hash locally afterwards.
 */
export async function confirmPinResetOnServer(input: {
  phone: string;
  code: string;
  pinHash: string;
}): Promise<void> {
  const response = await postJson(PIN_RESET_CONFIRM_PATH, input);
  if (response.ok) return;

  const payload = await readErrorPayload(response);
  if (response.status === 404) {
    throw new ApiError('phone-not-found', payload?.detail ?? 'That phone number is not registered.');
  }
  if (response.status === 410) {
    throw new ApiError('expired-code', payload?.detail ?? 'That code has expired.');
  }
  if (response.status === 429) {
    throw new ApiError('too-many-attempts', payload?.detail ?? 'Too many tries.');
  }
  if (response.status === 400 && payload?.code === 'invalid_code') {
    throw new ApiError('invalid-code', payload?.detail ?? 'That code is not correct.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the code and PIN.');
  }
  throw new ApiError('server', payload?.detail ?? 'The reset service could not save the new PIN.');
}

export type ServerStaff = {
  id: string;
  name: string;
  phone: string;
  role: 'staff';
};

export type StaffSignInResult = {
  staff: ServerStaff;
  owner: { name: string; phone: string };
};

/**
 * Registers a staff member under the owner. The owner's phone has already
 * checked the PIN twice and hashed it; the server only stores the hash.
 */
export async function registerStaffOnServer(input: {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  pin: string;
  pinHash: string;
  deviceToken: string;
}): Promise<ServerStaff> {
  const { deviceToken, ...body } = input;
  const response = await postJson(STAFF_REGISTER_PATH, body, {
    Authorization: `Bearer ${deviceToken}`,
  });
  if (response.ok) return (await response.json()) as ServerStaff;

  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'Sign in with the owner account again.');
  }
  if (response.status === 403) {
    throw new ApiError('forbidden', payload?.detail ?? 'That owner account does not match this phone.');
  }
  if (response.status === 409 && payload?.code === 'phone_taken') {
    throw new ApiError('duplicate-phone', payload?.detail ?? 'That phone number already has an account.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the staff details and try again.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not add this staff member.');
}

/** First staff sign-in on a phone. The PIN crosses TLS once and is checked
 * against the server's Django hash before the phone caches its own hash. */
export async function confirmStaffSignInOnServer(input: {
  phone: string;
  pin: string;
}): Promise<StaffSignInResult> {
  const response = await postJson(STAFF_SIGN_IN_CONFIRM_PATH, input);
  if (response.ok) return (await response.json()) as StaffSignInResult;

  const payload = await readErrorPayload(response);
  if (response.status === 429) {
    throw new ApiError('too-many-attempts', payload?.detail ?? 'Too many tries. Try again later.');
  }
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'That phone number and PIN do not match.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the phone number and PIN.');
  }
  throw new ApiError('server', payload?.detail ?? 'The sign-in service could not verify this PIN.');
}

/** Completes a staff member's first sign-in and caches the local PIN hash. */
export async function verifyStaffSignInOnServer(
  phone: string,
  pin: string
): Promise<StaffSignInResult> {
  return confirmStaffSignInOnServer({ phone, pin });
}
