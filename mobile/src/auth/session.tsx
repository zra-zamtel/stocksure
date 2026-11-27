import Storage from 'expo-sqlite/kv-store';
import {
  clearEmailPending,
  markEmailPending,
  readEmailPending,
  type EmailPending,
} from '@/lib/email-verify-store';
import { pendingCount, rememberShopOwnerId, restoreFromServer, shopOwnerId } from '@/db/sync';
import { wipeLocalShop } from '@/db/wipe';
import { markHandedOver } from '@/lib/hand-over-store';
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
  completeOnboarding,
  createOwner,
  getOnboardingState,
  getOwner,
  listIdentities,
  listStaff,
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
  refreshDeviceTokenOnServer,
  registerOwnerOnServer,
  confirmPasswordResetOnServer,
  requestEmailCodeOnServer,
  requestPasswordResetOnServer,
  requestPinResetOnServer,
  setOwnerDevicePinOnServer,
  verifyEmailCodeOnServer,
  verifyStaffSignInOnServer,
  type EmailCodeRequestResult,
  type OwnerSession,
  type PinResetRequestResult,
} from '@/lib/api';
import { hashPin, verifyPin } from '@/lib/pin';
import { clearPinGuard, pinGuardStatus, recordWrongPin, type GuardStatus } from '@/lib/pin-guard';

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
  | 'locked-out'
  /** The owner's PIN was one-time; the staff member must choose their own. */
  | 'choose-pin'
  /** Too many wrong PINs: wait before trying again. */
  | 'pin-locked'
  /** Far too many wrong PINs: this phone needs the owner's email sign-in. */
  | 'online-required';

/** A staff member who signed in with the owner's one-time PIN. */
export type StaffPinChange = { phone: string; pin: string; name: string };

export type PendingOwner = {
  owner: OwnerSession['owner'];
  deviceToken: string;
  refresh?: string;
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
  /** Set until a new owner types the 6-digit code emailed at sign-up. */
  emailPending: EmailPending | null;
  /**
   * Pulls the shop from the server onto a phone that has none. Afterwards the
   * phone either has the shop or, when the server holds none yet, carries on
   * with owner setup. Throws when the server cannot be reached.
   */
  restoreShop: () => Promise<void>;
  /** Email login succeeded; this phone still needs a local PIN. */
  pendingOwner: PendingOwner | null;
  /** Bearer token for owner-only online calls such as adding staff. */
  deviceToken: string | null;
  /**
   * Swaps the stored refresh key for a new device key after a 401. Returns the
   * new key, or null when the session is truly over and only an email sign-in
   * can reconnect the phone. Throws ApiError('offline') when there is no signal.
   */
  renewDeviceToken: () => Promise<string | null>;
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
  /** How long the PIN stays locked after wrong tries, and whether email sign-in is now required. */
  pinLock: () => Promise<GuardStatus>;
  /** A staff member's first sign-in on a phone that does not know them yet. */
  signInStaff: (input: { phone: string; pin: string; newPin?: string }) => Promise<'ok' | 'choose-pin'>;
  /** Set while a staff member must replace the owner's one-time PIN. */
  staffPinChange: StaffPinChange | null;
  cancelStaffPinChange: () => void;
  beginOwnerLogin: (input: { email: string; password: string }) => Promise<void>;
  /** Signs in with the emailed confirmation code; this phone then needs a PIN. */
  beginOwnerEmailCode: (input: { email: string; code: string }) => Promise<void>;
  /** Confirms the email of the owner already signed in on this phone. */
  confirmOwnerEmail: (input: { email: string; code: string }) => Promise<void>;
  requestOwnerEmailCode: (email: string, phone?: string) => Promise<EmailCodeRequestResult>;
  /**
   * Reconnects this phone to the owner's online account with an emailed code,
   * without leaving the current screen or setting a new PIN. Throws
   * OwnerMismatchError when the code belongs to a different owner account.
   */
  connectOwnerDevice: (input: { email: string; code: string }) => Promise<string>;
  requestOwnerPasswordReset: (email: string) => Promise<EmailCodeRequestResult>;
  /** Sets a new password with the emailed code; this phone then needs a PIN. */
  beginOwnerPasswordReset: (input: { email: string; code: string; password: string }) => Promise<void>;
  completeDeviceSetup: (input: { pin: string }) => Promise<void>;
  cancelOwnerLogin: () => void;
  requestPinResetCode: () => Promise<PinResetRequestResult>;
  resetPin: (input: { code: string; pin: string }) => Promise<void>;
  signOut: () => void;
  /**
   * Clears this phone for someone else, after the owner's PIN. Refuses while
   * any change is still waiting to upload, because those would be lost.
   * Everything already uploaded stays on the owner's account.
   */
  handOverPhone: (pin: string) => Promise<void>;
  refresh: () => Promise<void>;
};

/** Hand-over refused: 'pin' for a wrong owner PIN, 'pending' while changes wait to upload. */
export class HandOverError extends Error {
  constructor(public readonly reason: 'pin' | 'pending' | 'not-owner') {
    super(`hand-over-${reason}`);
    this.name = 'HandOverError';
  }
}

/** The staff member works for another owner's shop than the one on this phone. */
export class StaffWrongShopError extends Error {
  constructor(public readonly otherOwnerName: string) {
    super('staff-wrong-shop');
    this.name = 'StaffWrongShopError';
  }
}

/** The emailed code is valid but signs in a different owner than this phone's. */
export class OwnerMismatchError extends Error {
  constructor() {
    super('owner-mismatch');
    this.name = 'OwnerMismatchError';
  }
}

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
const REFRESH_TOKEN_KEY = 'stocksure.refreshToken';

/** The access key lasts hours; the refresh key (when the server sent one) renews it. */
async function storeDeviceToken(token: string, refresh?: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
    if (refresh) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
  } catch {
    // Without secure storage, online calls work until the app closes.
  }
}

/**
 * Everything this phone keeps outside SQLite about the shop and its people.
 * Language and theme stay: they describe the phone, not the shop.
 */
const SHOP_STORAGE_KEYS = [
  PENDING_KEY,
  RESTORE_KEY,
  'stocksure.emailPending',
  'stocksure.pinGuard',
  'stocksure.start.reconcile',
  'stocksure.start.tax',
  'stocksure.start.hidden',
];

async function forgetShopOutsideDatabase(): Promise<void> {
  for (const key of SHOP_STORAGE_KEYS) {
    try {
      Storage.removeItemSync(key);
    } catch {
      // A key that cannot be removed is reset by the next owner's setup.
    }
  }
  for (const key of [DEVICE_TOKEN_KEY, REFRESH_TOKEN_KEY]) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Without secure storage nothing was kept there.
    }
  }
}

async function readRefreshToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) ?? null;
  } catch {
    return null;
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
  // Whether any staff member exists; an owner with none records their own sales.
  const [hasStaff, setHasStaff] = useState(false);
  const [staffPinChange, setStaffPinChange] = useState<StaffPinChange | null>(null);
  const [shopRestorePending, setShopRestorePending] = useState(false);
  const [emailPending, setEmailPending] = useState<EmailPending | null>(readEmailPending);
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
      const [owner, identities, state, staff] = await Promise.all([
        getOwner(db),
        listIdentities(db),
        getOnboardingState(db),
        listStaff(db),
      ]);
      setHasStaff(staff.some((person) => person.role === 'staff'));
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
      await storeDeviceToken(session.deviceToken, session.refresh);
      setDeviceToken(session.deviceToken);
      pendingRegistration.current = null;
      clearPendingRegistration();
      // Older servers do not say; they always attempted the email.
      markEmailPending(owner.email ?? email, session.verificationSent !== false);
      setEmailPending({ email: owner.email ?? email, sent: session.verificationSent !== false });
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

      // Too many wrong PINs in a row lock the PIN, so it cannot be guessed.
      const guard = await pinGuardStatus();
      if (guard.requiresOnline) return 'online-required';
      if (guard.remainingMs > 0) return 'pin-locked';
      const wrongPin = async (): Promise<SignInResult> => {
        const after = await recordWrongPin();
        if (after.requiresOnline) return 'online-required';
        return after.remainingMs > 0 ? 'pin-locked' : 'wrong-pin';
      };

      const matches = [];
      for (const identity of identities) {
        if (await verifyPin(pin, identity.pinHash)) matches.push(identity);
      }
      if (matches.length === 0) return wrongPin();
      if (matches.length > 1) return 'ambiguous-pin';

      const matched = matches[0];
      if (matched.role === 'staff' && !matched.firstSignedInAt) {
        try {
          // The scope sheet makes this the one online moment for a staff
          // member. After it succeeds the local flag lets later sign-ins work
          // in airplane mode.
          const server = await verifyStaffSignInOnServer(matched.phone, pin);
          if (server.mustChangePin) {
            setStaffPinChange({ phone: matched.phone, pin, name: matched.name });
            return 'choose-pin';
          }
          await markStaffFirstSignIn(db, matched.id);
        } catch (cause) {
          if (cause instanceof ApiError && cause.code === 'offline') {
            return 'first-sign-in-offline';
          }
          if (cause instanceof ApiError && cause.code === 'unauthorized') {
            return wrongPin();
          }
          if (cause instanceof ApiError && cause.code === 'too-many-attempts') {
            return 'locked-out';
          }
          throw cause;
        }
      }

      clearPinGuard();
      setUser({ id: matched.id, name: matched.name, phone: matched.phone, role: matched.role });
      await refresh();
      return 'ok';
    },
    [db, refresh]
  );

  const pinLock = useCallback(() => pinGuardStatus(), []);

  const signInStaff = useCallback(
    async (input: { phone: string; pin: string; newPin?: string }): Promise<'ok' | 'choose-pin'> => {
      const phone = normalisePhone(input.phone);
      // The PIN this phone will keep: the staff member's own once chosen.
      const finalPin = input.newPin ?? input.pin;

      // Two people on one phone must have different PINs, or a later PIN-only
      // sign-in cannot tell them apart. Checked before the server changes it.
      if (input.newPin) {
        const identities = await listIdentities(db);
        for (const identity of identities) {
          if (identity.phone !== phone && (await verifyPin(finalPin, identity.pinHash))) {
            throw new Error('That PIN already unlocks someone else on this phone. Choose another.');
          }
        }
      }

      const server = await verifyStaffSignInOnServer(phone, input.pin, input.newPin);
      // This phone holds one shop. A staff member of another shop must not
      // sign in here: their sales would be recorded and uploaded as this shop's.
      const expectedOwner = await shopOwnerId(db);
      if (expectedOwner && server.owner.id && server.owner.id !== expectedOwner) {
        throw new StaffWrongShopError(server.owner.name);
      }
      if (server.mustChangePin) {
        setStaffPinChange({ phone, pin: input.pin, name: server.staff.name });
        return 'choose-pin';
      }

      const identities = await listIdentities(db);
      for (const identity of identities) {
        if (identity.id !== server.staff.id && (await verifyPin(finalPin, identity.pinHash))) {
          throw new Error('That PIN already unlocks someone else on this phone. Choose another.');
        }
      }

      const pinHash = await hashPin(finalPin);
      const staff = await upsertStaffFromServer(db, {
        id: server.staff.id,
        name: server.staff.name,
        phone: server.staff.phone,
        pinHash,
      });
      await markStaffFirstSignIn(db, staff.id);
      if (!expectedOwner && server.owner.id) await rememberShopOwnerId(db, server.owner.id);
      setStaffPinChange(null);
      clearPinGuard();
      setUser({ id: staff.id, name: staff.name, phone: staff.phone, role: 'staff' });
      setStatus('ready');
      setError(null);
      await refresh();
      return 'ok';
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
      setEmailPending(null);
      setPendingOwner({ owner: session.owner, deviceToken: session.deviceToken, refresh: session.refresh });
      setStatus('ready');
      setError(null);
    },
    []
  );

  const startOwnerSession = useCallback((session: OwnerSession) => {
    // Any accepted code proves the inbox, so the email is confirmed now.
    clearEmailPending();
    setEmailPending(null);
    setPendingOwner({ owner: session.owner, deviceToken: session.deviceToken, refresh: session.refresh });
    setStatus('ready');
    setError(null);
  }, []);

  const requestOwnerEmailCode = useCallback(
    async (email: string, phone?: string) =>
      requestEmailCodeOnServer(email.trim().toLowerCase(), phone),
    []
  );

  const beginOwnerEmailCode = useCallback(
    async (input: { email: string; code: string }) => {
      startOwnerSession(await verifyEmailCodeOnServer(input.email.trim().toLowerCase(), input.code));
    },
    [startOwnerSession]
  );

  const confirmOwnerEmail = useCallback(
    async (input: { email: string; code: string }) => {
      const session = await verifyEmailCodeOnServer(input.email.trim().toLowerCase(), input.code);
      clearEmailPending();
      setEmailPending(null);
      // The code also returns a fresh device key. Keep it when it is for the
      // owner on this phone, so online actions work without another sign-in.
      const owner = await getOwner(db);
      if (owner && owner.id === session.owner.id) {
        await storeDeviceToken(session.deviceToken, session.refresh);
        setDeviceToken(session.deviceToken);
      }
    },
    [db]
  );

  const connectOwnerDevice = useCallback(
    async (input: { email: string; code: string }) => {
      const session = await verifyEmailCodeOnServer(input.email.trim().toLowerCase(), input.code);
      const owner = await getOwner(db);
      if (!owner || owner.id !== session.owner.id) throw new OwnerMismatchError();
      clearEmailPending();
      setEmailPending(null);
      await storeDeviceToken(session.deviceToken, session.refresh);
      setDeviceToken(session.deviceToken);
      return session.deviceToken;
    },
    [db]
  );

  const requestOwnerPasswordReset = useCallback(
    async (email: string) => requestPasswordResetOnServer(email.trim().toLowerCase()),
    []
  );

  const beginOwnerPasswordReset = useCallback(
    async (input: { email: string; code: string; password: string }) => {
      startOwnerSession(
        await confirmPasswordResetOnServer({
          email: input.email.trim().toLowerCase(),
          code: input.code,
          password: input.password,
        })
      );
    },
    [startOwnerSession]
  );

  const completeDeviceSetup = useCallback(
    async (input: { pin: string }) => {
      if (!pendingOwner) throw new Error('Sign in with your email first');

      // If this phone already had the owner but the PIN was forgotten, the
      // shop data (and any unfinished onboarding) is still here. Only a truly
      // new phone needs to wait for a restore.
      const existingOwner = await getOwner(db);
      if (existingOwner && existingOwner.id !== pendingOwner.owner.id) {
        throw new Error(
          'This phone already belongs to another shop. Its owner can clear it in Settings, under Hand over this phone, or use another phone.'
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
      await storeDeviceToken(pendingOwner.deviceToken, pendingOwner.refresh);
      setDeviceToken(pendingOwner.deviceToken);
      // Signing in online proves it is the owner, so the PIN opens again.
      clearPinGuard();

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

  const restoreShop = useCallback(async () => {
    if (!deviceToken) throw new ApiError('unauthorized', 'Sign in with your email again to restore the shop.');
    await restoreFromServer(db, deviceToken);
    // Whatever the server held is now here. A shop that already has products was
    // set up and in use on the old phone (older builds never synced the "setup
    // finished" flag), so it opens on Home instead of repeating setup. If the
    // server held no shop (the account was just created and setup never
    // finished), owner setup takes over from here.
    const restored = await getOnboardingState(db);
    if (restored.hasShop && !restored.onboardingComplete && restored.hasProducts) {
      await completeOnboarding(db);
    }
    storeRestorePending(false);
    setShopRestorePending(false);
    await refresh();
  }, [db, deviceToken, refresh]);

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
      // The reset code proved it is the owner, so the PIN opens again.
      clearPinGuard();

      setOwnerPreview({ name: owner.name, phone: owner.phone, email: owner.email });
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      await refresh();
    },
    [db, refresh]
  );

  // The server rotates the refresh key and blacklists the old one, so two
  // screens renewing at once must share one request or the second would fail.
  const renewing = useRef<Promise<string | null> | null>(null);
  const renewDeviceToken = useCallback((): Promise<string | null> => {
    if (renewing.current) return renewing.current;
    renewing.current = (async () => {
      const stored = await readRefreshToken();
      if (!stored) return null;
      try {
        const next = await refreshDeviceTokenOnServer(stored);
        await storeDeviceToken(next.access, next.refresh);
        setDeviceToken(next.access);
        return next.access;
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'unauthorized') return null;
        throw cause;
      }
    })().finally(() => {
      renewing.current = null;
    });
    return renewing.current;
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const handOverPhone = useCallback(
    async (pin: string) => {
      const owner = await getOwner(db);
      if (!owner || user?.role !== 'owner') throw new HandOverError('not-owner');
      if (!(await verifyPin(pin, owner.pinHash))) throw new HandOverError('pin');
      // Checked last, right before clearing: a sale recorded on another tab a
      // moment ago must not be wiped before it uploads.
      if ((await pendingCount(db)) > 0) throw new HandOverError('pending');

      await wipeLocalShop(db);
      await forgetShopOutsideDatabase();
      clearPinGuard();
      pendingRegistration.current = null;
      setPendingOwner(null);
      setStaffPinChange(null);
      setEmailPending(null);
      setDeviceToken(null);
      setUser(null);
      markHandedOver();
      await refresh();
    },
    [db, refresh, user?.role]
  );

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
      emailPending,
      restoreShop,
      pendingOwner,
      deviceToken,
      onboardingComplete: onboarding.onboardingComplete,
      nextOnboardingRoute,
      can: (permission) => roleCan(user?.role, permission, { hasStaff }),
      registerOwner,
      signIn,
      pinLock,
      signInStaff,
      staffPinChange,
      cancelStaffPinChange: () => setStaffPinChange(null),
      beginOwnerLogin,
      beginOwnerEmailCode,
      confirmOwnerEmail,
      connectOwnerDevice,
      requestOwnerEmailCode,
      requestOwnerPasswordReset,
      beginOwnerPasswordReset,
      completeDeviceSetup,
      cancelOwnerLogin,
      requestPinResetCode,
      resetPin,
      signOut,
      handOverPhone,
      refresh,
      renewDeviceToken,
    };
  }, [
    handOverPhone,
    renewDeviceToken,
    beginOwnerLogin,
    beginOwnerEmailCode,
    beginOwnerPasswordReset,
    cancelOwnerLogin,
    confirmOwnerEmail,
    connectOwnerDevice,
    completeDeviceSetup,
    deviceToken,
    error,
    hasAccount,
    hasShop,
    hasStaff,
    onboarding,
    ownerPreview,
    pendingOwner,
    refresh,
    registerOwner,
    requestOwnerEmailCode,
    requestOwnerPasswordReset,
    requestPinResetCode,
    resetPin,
    shopRestorePending,
    emailPending,
    restoreShop,
    signIn,
    pinLock,
    signInStaff,
    signOut,
    staffPinChange,
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
