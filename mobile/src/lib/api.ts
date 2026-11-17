import Constants from 'expo-constants';
import { Platform } from 'react-native';

const REGISTER_PATH = '/api/v1/auth/register';
const TIMEOUT_MS = 12_000;

type RegisterOwnerRequest = {
  id: string;
  name: string;
  phone: string;
  pinHash: string;
};

export type ApiErrorCode = 'offline' | 'duplicate-phone' | 'validation' | 'server';

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

async function postJson(path: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

/** The one online call in the app: register the owner before caching locally. */
export async function registerOwnerOnServer(input: RegisterOwnerRequest): Promise<void> {
  const response = await postJson(REGISTER_PATH, input);
  if (response.ok) return;

  let payload: ErrorPayload | null = null;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    payload = null;
  }

  if (response.status === 409 && payload?.code === 'phone_taken') {
    throw new ApiError(
      'duplicate-phone',
      payload.detail ?? 'That phone number is already registered.'
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
