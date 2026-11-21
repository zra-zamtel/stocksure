import Storage from 'expo-sqlite/kv-store';
import { clearEmailPending, markEmailPending } from '@/lib/email-verify-store';
import * as SecureStore from 'expo-secure-store';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  can as roleCan,
  newId,
  normalisePhone,
  type Permission,
  type Role,
} from '@/core';
import {
  createOwner,
  getOnboardingState,
  getOwner,
  listIdentities,
  markStaffFirstSignIn,
  updateOwnerPinHash,
  upsertOwnerFromServer,
  upsertStaffFromServer,
  type OnboardingState,
} from '@/db/repos';
import {
  ApiError,
  confirmPinResetOnServer,
  loginOwnerOnServer,
  registerOwnerOnServer,
  requestMagicLinkOnServer,
  requestPinResetOnServer,
  setOwnerDevicePinOnServer,
  verifyMagicLinkOnServer,
  verifyStaffSignInOnServer,
  type MagicLinkRequestResult,
  type OwnerSession,
  type PinResetRequestResult,
} from '@/lib/api';
import { hashPin, verifyPin } from '@/lib/pin';

export type SessionUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
};

export type OnboardingRoute =
  | '/onboarding/shop'
  | '/onboarding/money'
  | '/onboarding/first-products';

type SignInResult =
  | 'ok'
  | 'wrong-pin'
  | 'no-account'
  | 'ambiguous-pin'
  | 'first-sign-in-offline'
  | 'locked-out';

export type PendingOwner = {
  owner: OwnerSession['owner'];
  deviceToken: string;
};

type AuthValue = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  user: SessionUser | null;
  /** Enough to welcome the owner back without keeping the PIN hash in memory. */
  ownerPreview: { name: string; phone: string; email?: string } | null;
  /** The owner row, kept for screens that predate staff accounts. */
  hasOwner: boolean;
  /** Anyone who can unlock this phone: the owner or a staff member. */
  hasAccount: boolean;
  hasShop: boolean;
  /** An owner restored a phone account but the shop data has not arrived yet. */
  shopRestorePending: boolean;
  /** Email login succeeded; this phone still needs a local PIN. */
  pendingOwner: PendingOwner | null;
  /** Bearer token for owner-only online calls such as adding staff. */
  deviceToken: string | null;
  onboardingComplete: boolean;
  nextOnboardingRoute: OnboardingRoute;
  /** The one permission check used by controls, actions and route guards. */
  can: (permission: Permission) => boolean;
  registerOwner: (input: {
    name: string;
    phone: string;
    email: string;
    password: string;
    pin: string;
  }) => Promise<void>;
  signIn: (pin: string) => Promise<SignInResult>;
  /** A staff member's first sign-in on a phone that does not know them yet. */
  signInStaff: (input: { phone: string; pin: string }) => Promise<void>;
  beginOwnerLogin: (input: { email: string; password: string }) => Promise<void>;
  /** Verifies the link and returns whose account it opened. */
  beginOwnerMagicLink: (token: string) => Promise<{ id: string }>;
  requestOwnerMagicLink: (email: string, phone?: string) => Promise<MagicLinkRequestResult>;
  completeDeviceSetup: (input: { pin: string }) => Promise<void>;
  cancelOwnerLogin: () => void;
  requestPinResetCode: () => Promise<PinResetRequestResult>;
  resetPin: (input: { code: string; pin: string }) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
};

const emptyOnboarding: OnboardingState = {
  hasShop: false,
  onboardingComplete: false,
  hasProducts: false,
};

type PendingRegistration = { phone: string; id: string };
const PENDING_KEY = 'stocksure.pendingRegistration';

function readPendingRegistration(): PendingRegistration | null {
  try {
    const raw = Storage.getItemSync(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingRegistration>;
    return typeof parsed.phone === 'string' && typeof parsed.id === 'string'
      ? { phone: parsed.phone, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function storePendingRegistration(pending: PendingRegistration): void {
  try {
    Storage.setItemSync(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // The retry still works while the app stays open; a storage failure only
    // loses the cross-restart idempotency.
  }
}

function clearPendingRegistration(): void {
  try {
    Storage.removeItemSync(PENDING_KEY);
  } catch {
    // Nothing depends on the key being gone.
  }
}

const RESTORE_KEY = 'stocksure.shopRestorePending';

function readRestorePending(): boolean {
  try {
    return Storage.getItemSync(RESTORE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeRestorePending(pending: boolean): void {
  try {
    if (pending) Storage.setItemSync(RESTORE_KEY, '1');
    else Storage.removeItemSync(RESTORE_KEY);
  } catch {
    // The in-memory flag still drives this run.
  }
}

const DEVICE_TOKEN_KEY = 'stocksure.deviceToken';

async function storeDeviceToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
  } catch {
    // Secure storage is only used to authenticate the owner when adding staff.
  }
}

async function readDeviceToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)) ?? null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Registration is the one online moment: the server accepts the owner first,
 * then the phone caches that owner so a cold start can be unlocked with the PIN
 * in airplane mode. Staff work the same way; their first sign-in on a phone is
 * checked online before the local row is trusted.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ownerPreview, setOwnerPreview] = useState<AuthValue['ownerPreview']>(null);
  const [hasAccount, setHasAccount] = useState(false);
  const [hasShop, setHasShop] = useState(false);
  const [shopRestorePending, setShopRestorePending] = useState(false);
  const [pendingOwner, setPendingOwner] = useState<PendingOwner | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState>(emptyOnboarding);
  // Reusing the id for retries makes a lost response safe: the server returns
  // the owner it already created instead of a duplicate-phone error. The ID is
  // persisted so that still holds if the app is killed between the two steps.
  const pendingRegistration = useRef<PendingRegistration | null>(null);

  useEffect(() => {
    pendingRegistration.current = readPendingRegistration();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [owner, identities, state] = await Promise.all([
        getOwner(db),
        listIdentities(db),
        getOnboardingState(db),
      ]);
      setOwnerPreview(
        owner ? { name: owner.name, phone: owner.phone, email: owner.email } : null
      );
      setDeviceToken(owner ? await readDeviceToken() : null);
      setHasAccount(identities.length > 0);
      setHasShop(state.hasShop);
      if (state.hasShop) {
        // The shop is here, so any "waiting for restore" flag is finished.
        storeRestorePending(false);
        setShopRestorePending(false);
      } else {
        setShopRestorePending(readRestorePending());
      }
      setOnboarding(state);
      setStatus('ready');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the local database');
      setStatus('error');
    }
  }, [db]);

  useEffect(() => {
    // The first read is the external-system sync this effect exists for. The
    // linter cannot see that refresh() only sets state after its async reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const registerOwner = useCallback(
    async (input: {
      name: string;
      phone: string;
      email: string;
      password: string;
      pin: string;
    }) => {
      const phone = normalisePhone(input.phone);
      const email = input.email.trim().toLowerCase();
      let pending = pendingRegistration.current;
      if (!pending || pending.phone !== phone) {
        pending = { phone, id: newId('owner') };
        pendingRegistration.current = pending;
        storePendingRegistration(pending);
      }
      const id = pending.id;
      const pinHash = await hashPin(input.pin);
      const name = input.name.trim();

      // No local account exists until the server accepts this. If the request
      // fails, the screen keeps the details and the same ID is retried.
      const session = await registerOwnerOnServer({
        id,
        name,
        phone,
        email,
        password: input.password,
        pinHash,
      });

      const owner = await createOwner(db, {
        id: session.owner.id,
        name: session.owner.name,
        phone: session.owner.phone,
        email: session.owner.email ?? email,
        pinHash,
      });
      await storeDeviceToken(session.deviceToken);
      setDeviceToken(session.deviceToken);
      pendingRegistration.current = null;
      clearPendingRegistration();
      // Older servers do not say; they always attempted the email.
      markEmailPending(owner.email ?? email, session.verificationSent !== false);
      setOwnerPreview({ name: owner.name, phone: owner.phone, email: owner.email });
      setHasAccount(true);
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      setOnboarding(await getOnboardingState(db));
      setStatus('ready');
      setError(null);
    },
    [db]
  );

  const signIn = useCallback(
    async (pin: string): Promise<SignInResult> => {
      const identities = await listIdentities(db);
      if (identities.length === 0) return 'no-account';

      const matches = [];
      for (const identity of identities) {
        if (await verifyPin(pin, identity.pinHash)) matches.push(identity);
      }
      if (matches.length === 0) return 'wrong-pin';
      if (matches.length > 1) return 'ambiguous-pin';

      const matched = matches[0];
      if (matched.role === 'staff' && !matched.firstSignedInAt) {
        try {
          // The scope sheet makes this the one online moment for a staff
          // member. After it succeeds the local flag lets later sign-ins work
          // in airplane mode.
          await verifyStaffSignInOnServer(matched.phone, pin);
          await markStaffFirstSignIn(db, matched.id);
        } catch (cause) {
          if (cause instanceof ApiError && cause.code === 'offline') {
            return 'first-sign-in-offline';
          }
          if (cause instanceof ApiError && cause.code === 'unauthorized') {
            return 'wrong-pin';
          }
          if (cause instanceof ApiError && cause.code === 'too-many-attempts') {
            return 'locked-out';
          }
          throw cause;
        }
      }

      setUser({ id: matched.id, name: matched.name, phone: matched.phone, role: matched.role });
      await refresh();
      return 'ok';
    },
    [db, refresh]
  );

  const signInStaff = useCallback(
    async (input: { phone: string; pin: string }) => {
      const phone = normalisePhone(input.phone);
      const server = await verifyStaffSignInOnServer(phone, input.pin);

      // Two people on one phone must have different PINs, or a later PIN-only
      // sign-in cannot tell them apart.
      const identities = await listIdentities(db);
      for (const identity of identities) {
        if (identity.id !== server.staff.id && (await verifyPin(input.pin, identity.pinHash))) {
          throw new Error('That PIN already unlocks someone else on this phone. Choose another.');
        }
      }

      const pinHash = await hashPin(input.pin);
      const staff = await upsertStaffFromServer(db, {
        id: server.staff.id,
        name: server.staff.name,
        phone: server.staff.phone,
        pinHash,
      });
      await markStaffFirstSignIn(db, staff.id);
      setUser({ id: staff.id, name: staff.name, phone: staff.phone, role: 'staff' });
      setStatus('ready');
      setError(null);
      await refresh();
    },
    [db, refresh]
  );

  const beginOwnerLogin = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await loginOwnerOnServer({
        email: input.email.trim().toLowerCase(),
        password: input.password,
      });
      // A password sign-in only succeeds for a confirmed email.
      clearEmailPending();
      setPendingOwner({ owner: session.owner, deviceToken: session.deviceToken });
      setStatus('ready');
      setError(null);
    },
    []
  );

  const requestOwnerMagicLink = useCallback(
    async (email: string, phone?: string) =>
      requestMagicLinkOnServer(email.trim().toLowerCase(), phone),
    []
  );

  const beginOwnerMagicLink = useCallback(async (token: string) => {
    const session = await verifyMagicLinkOnServer(token);
    // Opening any link proves the inbox, so the email is confirmed now.
    clearEmailPending();
    setPendingOwner({ owner: session.owner, deviceToken: session.deviceToken });
    setStatus('ready');
    setError(null);
    return { id: session.owner.id };
  }, []);

  const completeDeviceSetup = useCallback(
    async (input: { pin: string }) => {
      if (!pendingOwner) throw new Error('Sign in with your email first');

      // If this phone already had the owner but the PIN was forgotten, the
      // shop data (and any unfinished onboarding) is still here. Only a truly
      // new phone needs to wait for a restore.
      const existingOwner = await getOwner(db);
      if (existingOwner && existingOwner.id !== pendingOwner.owner.id) {
        throw new Error(
          'This phone already has a different owner account. Use a separate phone or wipe this one first.'
        );
      }
      const identities = await listIdentities(db);
      for (const identity of identities) {
        if (identity.role === 'staff' && (await verifyPin(input.pin, identity.pinHash))) {
          throw new Error('That PIN already unlocks a staff member on this phone. Choose another.');
        }
      }

      const pinHash = await hashPin(input.pin);
      await setOwnerDevicePinOnServer({
        deviceToken: pendingOwner.deviceToken,
        pinHash,
      });
      const owner = await upsertOwnerFromServer(db, {
        id: pendingOwner.owner.id,
        name: pendingOwner.owner.name,
        phone: pendingOwner.owner.phone,
        email: pendingOwner.owner.email,
        pinHash,
      });
      await storeDeviceToken(pendingOwner.deviceToken);
      setDeviceToken(pendingOwner.deviceToken);

      const state = await getOnboardingState(db);
      const restorePending = existingOwner === null && !state.hasShop;
      storeRestorePending(restorePending);
      setShopRestorePending(restorePending);

      setPendingOwner(null);
      setOwnerPreview({ name: owner.name, phone: owner.phone, email: owner.email });
      setHasAccount(true);
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      await refresh();
    },
    [db, pendingOwner, refresh]
  );

  const cancelOwnerLogin = useCallback(() => setPendingOwner(null), []);

  const requestPinResetCode = useCallback(async () => {
    const owner = await getOwner(db);
    if (!owner) throw new Error('No owner account is stored on this phone');
    return requestPinResetOnServer(owner.phone);
  }, [db]);

  const resetPin = useCallback(
    async (input: { code: string; pin: string }) => {
      const owner = await getOwner(db);
      if (!owner) throw new Error('No owner account is stored on this phone');

      // Sign-in matches a PIN against everyone on the phone. A new owner PIN
      // must not collide with a staff PIN, or the next unlock is ambiguous.
      const identities = await listIdentities(db);
      for (const identity of identities) {
        if (identity.id !== owner.id && (await verifyPin(input.pin, identity.pinHash))) {
          throw new Error('That PIN already unlocks a staff member on this phone. Choose another.');
        }
      }

      const pinHash = await hashPin(input.pin);
      await confirmPinResetOnServer({ phone: owner.phone, code: input.code, pinHash });
      await updateOwnerPinHash(db, owner.id, pinHash);

      setOwnerPreview({ name: owner.name, phone: owner.phone, email: owner.email });
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      await refresh();
    },
    [db, refresh]
  );

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo<AuthValue>(() => {
    const nextOnboardingRoute: OnboardingRoute = !onboarding.hasShop
      ? '/onboarding/shop'
      : onboarding.hasProducts
        ? '/onboarding/first-products'
        : '/onboarding/money';

    return {
      status,
      error,
      user,
      ownerPreview,
      hasOwner: ownerPreview !== null,
      hasAccount,
      hasShop,
      shopRestorePending,
      pendingOwner,
      deviceToken,
      onboardingComplete: onboarding.onboardingComplete,
      nextOnboardingRoute,
      can: (permission) => roleCan(user?.role, permission),
      registerOwner,
      signIn,
      signInStaff,
      beginOwnerLogin,
      beginOwnerMagicLink,
      requestOwnerMagicLink,
      completeDeviceSetup,
      cancelOwnerLogin,
      requestPinResetCode,
      resetPin,
      signOut,
      refresh,
    };
  }, [
    beginOwnerLogin,
    beginOwnerMagicLink,
    cancelOwnerLogin,
    completeDeviceSetup,
    deviceToken,
    error,
    hasAccount,
    hasShop,
    onboarding,
    ownerPreview,
    pendingOwner,
    refresh,
    registerOwner,
    requestOwnerMagicLink,
    requestPinResetCode,
    resetPin,
    shopRestorePending,
    signIn,
    signInStaff,
    signOut,
    status,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
