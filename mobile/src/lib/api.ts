import Constants from 'expo-constants';
import { Platform } from 'react-native';

const REGISTER_PATH = '/api/v1/auth/register';
const LOGIN_PATH = '/api/v1/auth/login';
const EMAIL_CODE_REQUEST_PATH = '/api/v1/auth/email-code/request';
const EMAIL_CODE_VERIFY_PATH = '/api/v1/auth/email-code/verify';
const EMAIL_CHANGE_PATH = '/api/v1/auth/email-change';
const PASSWORD_RESET_REQUEST_PATH = '/api/v1/auth/password-reset/request';
const PASSWORD_RESET_CONFIRM_PATH = '/api/v1/auth/password-reset/confirm';
const DEVICE_PIN_PATH = '/api/v1/auth/device-pin';
const PIN_RESET_REQUEST_PATH = '/api/v1/auth/pin-reset/request';
const PIN_RESET_CONFIRM_PATH = '/api/v1/auth/pin-reset/confirm';
const STAFF_REGISTER_PATH = '/api/v1/auth/staff';
const STAFF_SIGN_IN_CONFIRM_PATH = '/api/v1/auth/staff-sign-in/confirm';
const SYNC_PUSH_PATH = '/api/v1/sync/push';
const SYNC_PULL_PATH = '/api/v1/sync/pull';
const TOKEN_REFRESH_PATH = '/api/v1/auth/refresh/';
const TIMEOUT_MS = 12_000;

function staffPinResetPath(staffId: string): string {
  return `/api/v1/auth/staff/${encodeURIComponent(staffId)}/pin-reset`;
}

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
  /** Long-lived key that renews deviceToken (which lasts hours) without a new sign-in. */
  refresh?: string;
  /** Sign-up only: whether the server managed to email the confirmation code. */
  verificationSent?: boolean;
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
  | 'staff-not-found'
  | 'invalid-credentials'
  | 'email-unverified'
  /** The email is already confirmed, so it cannot be changed before sign-up ends. */
  | 'email-verified'
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
    message: string,
    /** Extra facts the server sent with the refusal, e.g. that a code was emailed. */
    public readonly details: { verificationSent?: boolean; demoCode?: string } = {}
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

async function getJson(
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('offline', 'Could not reach the sync service');
  } finally {
    clearTimeout(timer);
  }
}

type ErrorPayload = { code?: string; detail?: string; verificationSent?: boolean; demoCode?: string };

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
  if (response.status === 403 && payload?.code === 'email_unverified') {
    throw new ApiError(
      'email-unverified',
      payload.detail ?? 'Confirm your email with the emailed code before using your password.',
      { verificationSent: payload.verificationSent === true, demoCode: payload.demoCode }
    );
  }
  if (response.status === 401) {
    throw new ApiError('invalid-credentials', payload?.detail ?? 'That email and password do not match.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the email address and password.');
  }
  throw new ApiError('server', payload?.detail ?? 'The sign-in service could not be reached.');
}

export type EmailCodeRequestResult = {
  expiresAt: string;
  /** Local demo servers only. */
  demoCode?: string;
};

async function readCodeRequest(response: Response): Promise<EmailCodeRequestResult> {
  if (response.ok) {
    const payload = (await response.json()) as Partial<EmailCodeRequestResult>;
    return { expiresAt: payload.expiresAt ?? '', demoCode: payload.demoCode };
  }
  const payload = await readErrorPayload(response);
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the email address.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not send an email.');
}

async function readCodeSession(response: Response): Promise<OwnerSession> {
  if (response.ok) return (await response.json()) as OwnerSession;
  const payload = await readErrorPayload(response);
  if (response.status === 400 && payload?.code === 'invalid_code') {
    throw new ApiError('invalid-code', payload.detail ?? 'That code is not correct.');
  }
  if (response.status === 410) {
    throw new ApiError('expired-code', payload?.detail ?? 'That code has expired.');
  }
  if (response.status === 429) {
    throw new ApiError('too-many-attempts', payload?.detail ?? 'Too many tries. Request a new code.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the code and try again.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not check the code.');
}

/**
 * Email a fresh 6-digit code to confirm the address. The response is generic
 * for unknown emails. The server also needs the account phone number, so an
 * inbox owner cannot be handed a stranger's account.
 */
export async function requestEmailCodeOnServer(
  email: string,
  phone?: string
): Promise<EmailCodeRequestResult> {
  const body = phone ? { email, phone } : { email };
  return readCodeRequest(await postJson(EMAIL_CODE_REQUEST_PATH, body));
}

/** Check the emailed code; the email is confirmed and this phone gets a session. */
export async function verifyEmailCodeOnServer(email: string, code: string): Promise<OwnerSession> {
  return readCodeSession(await postJson(EMAIL_CODE_VERIFY_PATH, { email, code }));
}

export type EmailChangeResult = {
  owner: ServerOwner;
  /** Whether the server managed to email a code to the new address. */
  verificationSent: boolean;
  /** Local demo servers only. */
  demoCode?: string;
};

/**
 * Fix a mistyped email before it is confirmed. The sign-up device key proves
 * it is the same owner; a fresh code goes to the new address.
 */
export async function changeEmailOnServer(input: {
  deviceToken: string;
  email: string;
}): Promise<EmailChangeResult> {
  const response = await postJson(
    EMAIL_CHANGE_PATH,
    { email: input.email },
    { Authorization: `Bearer ${input.deviceToken}` }
  );
  if (response.ok) {
    const payload = (await response.json()) as Partial<EmailChangeResult> & { owner: ServerOwner };
    return {
      owner: payload.owner,
      verificationSent: payload.verificationSent !== false,
      demoCode: payload.demoCode,
    };
  }
  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'Sign in again to change the email.');
  }
  if (response.status === 409 && payload?.code === 'email_taken') {
    throw new ApiError('duplicate-email', payload.detail ?? 'That email address is already registered.');
  }
  if (response.status === 409 && payload?.code === 'email_verified') {
    throw new ApiError('email-verified', payload.detail ?? 'This email is already confirmed.');
  }
  if (response.status === 403) {
    throw new ApiError('forbidden', payload?.detail ?? 'Only the owner can change this email.');
  }
  if (response.status === 429) {
    throw new ApiError('too-many-attempts', payload?.detail ?? 'Too many tries. Wait a minute.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the email address.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not change the email.');
}

/** Email a code for setting a new password. Generic for unknown emails. */
export async function requestPasswordResetOnServer(email: string): Promise<EmailCodeRequestResult> {
  return readCodeRequest(await postJson(PASSWORD_RESET_REQUEST_PATH, { email }));
}

/** Set a new password with the emailed code; this phone gets a session. */
export async function confirmPasswordResetOnServer(input: {
  email: string;
  code: string;
  password: string;
}): Promise<OwnerSession> {
  return readCodeSession(await postJson(PASSWORD_RESET_CONFIRM_PATH, input));
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
  /** id: newer servers send it, so the phone can refuse staff of another shop. */
  owner: { id?: string; name: string; phone: string };
  /** The owner's PIN was one-time: ask the staff member to choose their own. */
  mustChangePin?: boolean;
};

/**
 * Registers a staff member under the owner. The PIN crosses TLS once so the
 * server can keep a verifier for the first sign-in; the phone keeps its own
 * salted hash for offline sign-in.
 */
export async function registerStaffOnServer(input: {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  pin: string;
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

/**
 * Replaces a staff member's PIN. Only the signed-in owner can do this; the
 * phone has already checked the new PIN and hashed it for offline sign-in.
 */
export async function resetStaffPinOnServer(input: {
  staffId: string;
  pin: string;
  deviceToken: string;
}): Promise<ServerStaff> {
  const { deviceToken, staffId, ...body } = input;
  const response = await postJson(staffPinResetPath(staffId), body, {
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
  if (response.status === 404) {
    throw new ApiError('staff-not-found', payload?.detail ?? 'That staff member is not part of this shop.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the new PIN and try again.');
  }
  throw new ApiError('server', payload?.detail ?? 'The account service could not change this PIN.');
}

/** First staff sign-in on a phone. The PIN crosses TLS once and is checked
 * against the server's Django hash before the phone caches its own hash. */
export async function confirmStaffSignInOnServer(input: {
  phone: string;
  pin: string;
  newPin?: string;
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
  pin: string,
  newPin?: string
): Promise<StaffSignInResult> {
  return confirmStaffSignInOnServer(newPin ? { phone, pin, newPin } : { phone, pin });
}

export type SyncOperation = 'create' | 'update';

export type SyncChangePayload = {
  queueId: string;
  entity: string;
  entityId: string;
  operation: SyncOperation;
  payload: unknown;
  clientCreatedAt?: string;
  attempts?: number;
};

export type SyncPushResult = {
  accepted: string[];
  rejected: { queueId: string; reason: string }[];
  serverTime: string;
  cursor: string;
};

export type SyncPullChange = {
  entity: string;
  entityId: string;
  operation: SyncOperation;
  payload: unknown;
  cursor: string;
  clientCreatedAt: string;
};

export type SyncPullResult = {
  changes: SyncPullChange[];
  nextCursor: string;
  serverTime: string;
};

/**
 * Sends the phone's outbox. The server accepts or rejects each row on its own;
 * a rejected row stays queued and keeps its reason, so nothing is lost.
 */
export async function pushSync(input: {
  deviceId: string;
  batchId: string;
  changes: SyncChangePayload[];
  accessToken: string;
  /** This phone's shop. Without it the server falls back to the user's first shop. */
  shopId?: string;
}): Promise<SyncPushResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${input.accessToken}` };
  if (input.shopId) headers['X-Shop-ID'] = input.shopId;
  const response = await postJson(
    SYNC_PUSH_PATH,
    { deviceId: input.deviceId, batchId: input.batchId, changes: input.changes },
    headers
  );
  if (response.ok) return (await response.json()) as SyncPushResult;

  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'Sign in again to sync.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'The sync batch could not be sent.');
  }
  throw new ApiError('server', payload?.detail ?? 'The sync service could not store this batch.');
}

/** Pulls changes made elsewhere after the cursor. */
export async function pullSync(input: {
  accessToken: string;
  cursor?: string;
  limit?: number;
  shopId?: string;
}): Promise<SyncPullResult> {
  const params = new URLSearchParams({
    cursor: input.cursor ?? '0',
    limit: String(input.limit ?? 500),
  });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
  };
  if (input.shopId) headers['X-Shop-ID'] = input.shopId;

  const response = await getJson(`${SYNC_PULL_PATH}?${params.toString()}`, headers);
  if (response.ok) return (await response.json()) as SyncPullResult;

  const payload = await readErrorPayload(response);
  if (response.status === 401) {
    throw new ApiError('unauthorized', payload?.detail ?? 'Sign in again to sync.');
  }
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'The sync cursor is not valid.');
  }
  throw new ApiError('server', payload?.detail ?? 'The sync service could not send changes.');
}

// --- Request to pay -------------------------------------------------------

export type PaymentRequestStatus = 'pending' | 'successful' | 'failed' | 'expired';

export type PaymentRequest = {
  id: string;
  provider: 'MTN' | 'Airtel' | 'Zamtel';
  phone: string;
  /** The sale's amount, in ngwee. */
  amount: number;
  /** The mobile money fee passed on to the customer (older servers omit it). */
  fee?: number;
  /** What the customer is asked for: amount + fee. */
  charged?: number;
  status: PaymentRequestStatus;
  reference: string;
  reason: string;
  createdAt: string;
  completedAt: string | null;
};

const REQUEST_TO_PAY_PATH = '/api/v1/collections/request-to-pay';

function paymentRequestError(response: Response, payload: ErrorPayload | null): ApiError {
  if (response.status === 401) return new ApiError('unauthorized', payload?.detail ?? 'Sign in again.');
  if (response.status === 400) return new ApiError('validation', payload?.detail ?? 'Check the phone number and amount.');
  return new ApiError('server', payload?.detail ?? 'The payment service could not be reached.');
}

/**
 * Asks the customer's wallet for the amount; they approve with their PIN on
 * their own phone. The id comes from the phone, so retrying after a dropped
 * connection returns the same request instead of prompting the customer again.
 */
export async function requestToPayOnServer(input: {
  id: string;
  provider: 'MTN' | 'Airtel' | 'Zamtel';
  phone: string;
  amount: number;
  deviceToken: string;
}): Promise<PaymentRequest> {
  const { deviceToken, ...body } = input;
  const response = await postJson(REQUEST_TO_PAY_PATH, body, { Authorization: `Bearer ${deviceToken}` });
  if (response.ok) return (await response.json()) as PaymentRequest;
  throw paymentRequestError(response, await readErrorPayload(response));
}

export type FeeQuote = { amount: number; fee: number; charged: number; feePercent: string };

/** What the customer will be asked for a sale of `amount` ngwee, fee included. */
export async function feeQuoteOnServer(input: { amount: number; deviceToken: string }): Promise<FeeQuote> {
  const response = await getJson(`/api/v1/collections/quote?amount=${encodeURIComponent(String(input.amount))}`, {
    Authorization: `Bearer ${input.deviceToken}`,
  });
  if (response.ok) return (await response.json()) as FeeQuote;
  throw paymentRequestError(response, await readErrorPayload(response));
}

export async function paymentRequestStatusOnServer(input: {
  id: string;
  deviceToken: string;
}): Promise<PaymentRequest> {
  const response = await getJson(`${REQUEST_TO_PAY_PATH}/${encodeURIComponent(input.id)}`, {
    Authorization: `Bearer ${input.deviceToken}`,
  });
  if (response.ok) return (await response.json()) as PaymentRequest;
  throw paymentRequestError(response, await readErrorPayload(response));
}

// ---- Smart Invoice (simulated ZRA bridge) ----------------------------------

export type SmartInvoiceStatus =
  | { connected: false }
  | {
      connected: true;
      simulated: boolean;
      tpin: string;
      branchId: string;
      taxpayerName: string;
      sdcId: string;
      mrcNo: string;
      connectedAt: string;
      sentCount: number;
      refundCount: number;
      failedCount: number;
      waitingCount: number;
      lastSentAt: string | null;
    };

async function readSmartInvoice(response: Response): Promise<SmartInvoiceStatus> {
  if (response.ok) return (await response.json()) as SmartInvoiceStatus;
  const payload = await readErrorPayload(response);
  if (response.status === 400) {
    throw new ApiError('validation', payload?.detail ?? 'Check the TPIN.');
  }
  if (response.status === 401) throw new ApiError('unauthorized', payload?.detail ?? 'Sign in again.');
  if (response.status === 403) throw new ApiError('forbidden', payload?.detail ?? 'Only the owner can do this.');
  throw new ApiError('server', payload?.detail ?? 'Smart Invoice could not be reached.');
}

export async function getSmartInvoiceStatusOnServer(input: {
  deviceToken: string;
  shopId: string;
}): Promise<SmartInvoiceStatus> {
  return readSmartInvoice(
    await getJson(`/api/v1/smart-invoice/status?shopId=${encodeURIComponent(input.shopId)}`, {
      Authorization: `Bearer ${input.deviceToken}`,
    })
  );
}

/** The one step the trader takes: StockSure registers the shop and sends every sale. */
export async function connectSmartInvoiceOnServer(input: {
  deviceToken: string;
  shopId: string;
  tpin: string;
}): Promise<SmartInvoiceStatus> {
  return readSmartInvoice(
    await postJson(
      '/api/v1/smart-invoice/connect',
      { shopId: input.shopId, tpin: input.tpin },
      { Authorization: `Bearer ${input.deviceToken}` }
    )
  );
}

export type SmartInvoiceSent = {
  receiptType: 'S' | 'R';
  invoiceNo: number;
  request: Record<string, unknown>;
};

/** What was sent to ZRA for one sale, field by field. */
export async function getSmartInvoiceSaleOnServer(input: {
  deviceToken: string;
  saleId: string;
}): Promise<SmartInvoiceSent[]> {
  const response = await getJson(`/api/v1/smart-invoice/sales/${encodeURIComponent(input.saleId)}`, {
    Authorization: `Bearer ${input.deviceToken}`,
  });
  if (response.ok) return ((await response.json()) as { receipts: SmartInvoiceSent[] }).receipts;
  throw new ApiError('server', 'Smart Invoice could not be reached.');
}

// ---- Renewing the device key ------------------------------------------------

/**
 * Swaps the refresh key for a fresh access key. The server rotates the refresh
 * key, so the new one must be stored. 401 means the refresh key itself has
 * expired or was revoked: only an email sign-in fixes that.
 */
export async function refreshDeviceTokenOnServer(
  refresh: string
): Promise<{ access: string; refresh: string }> {
  const response = await postJson(TOKEN_REFRESH_PATH, { refresh });
  if (response.ok) {
    const body = (await response.json()) as { access: string; refresh?: string };
    return { access: body.access, refresh: body.refresh ?? refresh };
  }
  if (response.status === 401 || response.status === 400) {
    throw new ApiError('unauthorized', 'Your session has expired.');
  }
  throw new ApiError('server', 'The account service could not be reached.');
}

// ---- Trading Record (proof of trading for a bank or MFI) --------------------

export type TradingRecordMonth = {
  month: string;
  recorded_sales: number;
  sale_count: number;
  trading_days: number;
  mobile_money_matched: number;
  cash_balanced_close: number;
  recorded_only: number;
};

/** The sealed figures, exactly as the server hashed them. Amounts are ngwee. */
export type TradingRecordPayload = {
  schema: string;
  record_id: string;
  issued_at: string;
  expires_at: string;
  currency: string;
  business: { name: string; town: string; type: string; owner_name: string };
  period: { months: number; start: string; end: string };
  totals: {
    recorded_sales: number;
    sale_count: number;
    trading_days: number;
    mobile_money_matched: number;
    cash_balanced_close: number;
    recorded_only: number;
  };
  cash_closes: { days_closed: number; days_balanced: number; days_not_balanced: number };
  months: TradingRecordMonth[];
  data: {
    first_synced_at: string | null;
    data_through: string | null;
    late_sync_days: number;
    synced_late_value: number;
    sync_time_unknown_value: number;
  };
  margin: {
    revenue: number;
    cost_of_goods: number;
    gross_margin: number;
    gross_margin_bp: number;
    note: string;
  } | null;
  tax: {
    periods: {
      starts_on: string;
      ends_on: string;
      declared_turnover: number;
      corroborated_sales: number;
      variance_vs_corroborated: number;
    }[];
    filing: string;
    amendments: string;
    note: string;
  } | null;
  labels: Record<string, string>;
  not_this: string[];
};

export type TradingRecordSummary = {
  id: string;
  periodMonths: number;
  periodStart: string;
  periodEnd: string;
  includeMargin: boolean;
  includeTax: boolean;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  state: 'valid' | 'expired' | 'revoked';
  viewCount: number;
  lastViewedAt: string | null;
  seal: string;
  payloadHash: string;
  payload: TradingRecordPayload;
};

/** Only the issue response carries the link: the server keeps just its hash. */
export type IssuedTradingRecord = TradingRecordSummary & {
  token: string;
  verifyUrl: string;
  qrSvg: string;
};

const TRADING_RECORDS_PATH = '/api/v1/trading-records/';

async function tradingRecordError(response: Response): Promise<ApiError> {
  const payload = await readErrorPayload(response);
  if (response.status === 400) return new ApiError('validation', payload?.detail ?? 'Check the options.');
  if (response.status === 401) return new ApiError('unauthorized', payload?.detail ?? 'Sign in again.');
  if (response.status === 403) return new ApiError('forbidden', payload?.detail ?? 'Only the owner can do this.');
  return new ApiError('server', payload?.detail ?? 'The trading record service could not be reached.');
}

export async function issueTradingRecordOnServer(input: {
  deviceToken: string;
  shopId: string;
  months: 3 | 6 | 12;
  expiresInDays: 14 | 30;
  includeMargin: boolean;
  includeTax: boolean;
}): Promise<IssuedTradingRecord> {
  const { deviceToken, ...body } = input;
  const response = await postJson(TRADING_RECORDS_PATH, body, {
    Authorization: `Bearer ${deviceToken}`,
    'X-Shop-ID': input.shopId,
  });
  if (response.ok) return (await response.json()) as IssuedTradingRecord;
  throw await tradingRecordError(response);
}

export async function listTradingRecordsOnServer(input: {
  deviceToken: string;
  shopId: string;
}): Promise<TradingRecordSummary[]> {
  const response = await getJson(`${TRADING_RECORDS_PATH}?shopId=${encodeURIComponent(input.shopId)}`, {
    Authorization: `Bearer ${input.deviceToken}`,
    'X-Shop-ID': input.shopId,
  });
  if (response.ok) return ((await response.json()) as { records: TradingRecordSummary[] }).records;
  throw await tradingRecordError(response);
}

export async function revokeTradingRecordOnServer(input: {
  deviceToken: string;
  id: string;
}): Promise<TradingRecordSummary> {
  const response = await postJson(`${TRADING_RECORDS_PATH}${encodeURIComponent(input.id)}/revoke`, {}, {
    Authorization: `Bearer ${input.deviceToken}`,
  });
  if (response.ok) return (await response.json()) as TradingRecordSummary;
  throw await tradingRecordError(response);
}
