import type { Href } from 'expo-router';
import { useAuth } from '@/auth/session';

/**
 * Where this phone belongs right now: an account, a PIN, a new email login,
 * the rest of setup, a waiting screen for restored shop data, or the tabs.
 *
 * The cold-start gate (app/index.tsx) redirects here, and every protected
 * group in the root layout redirects here when its guard turns off. Without
 * that, signing out left the open screen redirecting to "/", which can match
 * the locked Today tab (app/(tabs)/index.tsx) instead of the gate: a blank
 * screen.
 */
export function useGateRoute(): Href {
  const {
    user,
    pendingOwner,
    hasAccount,
    hasShop,
    shopRestorePending,
    emailPending,
    onboardingComplete,
    nextOnboardingRoute,
  } = useAuth();

  if (pendingOwner) return '/set-phone-pin';
  if (!hasAccount) return '/onboarding/language';
  if (!user) return '/sign-in';
  // A new owner finishes creating the account by confirming the emailed code.
  if (user.role === 'owner' && emailPending) return '/onboarding/verify-email';
  if (
    (user.role === 'staff' && (!hasShop || !onboardingComplete)) ||
    (!hasShop && shopRestorePending)
  ) {
    return '/shop-pending';
  }
  if (!onboardingComplete) return nextOnboardingRoute;
  return '/(tabs)';
}
