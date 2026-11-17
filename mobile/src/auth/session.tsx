import Storage from 'expo-sqlite/kv-store';
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
import { newId, normalisePhone } from '@/core';
import {
  createOwner,
  getOnboardingState,
  getOwner,
  type OnboardingState,
} from '@/db/repos';
import { registerOwnerOnServer } from '@/lib/api';
import { hashPin, verifyPin } from '@/lib/pin';

export type SessionUser = {
  id: string;
  name: string;
  phone: string;
  role: 'owner';
};

export type OnboardingRoute =
  | '/onboarding/shop'
  | '/onboarding/money'
  | '/onboarding/first-products';

type SignInResult = 'ok' | 'wrong-pin' | 'no-owner';

type AuthValue = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  user: SessionUser | null;
  /** Enough to welcome the owner back without keeping the PIN hash in memory. */
  ownerPreview: { name: string; phone: string } | null;
  hasOwner: boolean;
  onboardingComplete: boolean;
  nextOnboardingRoute: OnboardingRoute;
  registerOwner: (input: { name: string; phone: string; pin: string }) => Promise<void>;
  signIn: (pin: string) => Promise<SignInResult>;
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

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Registration is the one online moment: the server accepts the owner first,
 * then the phone caches that owner so a cold start can be unlocked with the PIN
 * in airplane mode.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ownerPreview, setOwnerPreview] = useState<AuthValue['ownerPreview']>(null);
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
      const [owner, state] = await Promise.all([getOwner(db), getOnboardingState(db)]);
      setOwnerPreview(owner ? { name: owner.name, phone: owner.phone } : null);
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
    async (input: { name: string; phone: string; pin: string }) => {
      const phone = normalisePhone(input.phone);
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
      await registerOwnerOnServer({ id, name, phone, pinHash });

      const owner = await createOwner(db, { id, name, phone, pinHash });
      pendingRegistration.current = null;
      clearPendingRegistration();
      setOwnerPreview({ name: owner.name, phone: owner.phone });
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      setOnboarding(await getOnboardingState(db));
      setStatus('ready');
      setError(null);
    },
    [db]
  );

  const signIn = useCallback(
    async (pin: string): Promise<SignInResult> => {
      const owner = await getOwner(db);
      if (!owner) return 'no-owner';
      if (!(await verifyPin(pin, owner.pinHash))) return 'wrong-pin';
      setUser({ id: owner.id, name: owner.name, phone: owner.phone, role: 'owner' });
      await refresh();
      return 'ok';
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
      onboardingComplete: onboarding.onboardingComplete,
      nextOnboardingRoute,
      registerOwner,
      signIn,
      signOut,
      refresh,
    };
  }, [error, onboarding, ownerPreview, refresh, registerOwner, signIn, signOut, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
