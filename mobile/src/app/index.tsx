import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/session';

/**
 * Every cold start lands here. The gate decides whether this phone needs an
 * account, a PIN, a new email login, the rest of setup, a waiting screen for
 * restored shop data, or the tabs.
 */
export default function Index() {
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

  if (pendingOwner) return <Redirect href="/set-phone-pin" />;
  if (!hasAccount) return <Redirect href="/onboarding/language" />;
  if (!user) return <Redirect href="/sign-in" />;
  // A new owner finishes creating the account by confirming the emailed code.
  if (user.role === 'owner' && emailPending) return <Redirect href="/onboarding/verify-email" />;
  if (
    (user.role === 'staff' && (!hasShop || !onboardingComplete)) ||
    (!hasShop && shopRestorePending)
  ) {
    return <Redirect href="/shop-pending" />;
  }
  if (!onboardingComplete) return <Redirect href={nextOnboardingRoute} />;
  return <Redirect href="/(tabs)" />;
}
