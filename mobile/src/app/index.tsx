import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/session';

/**
 * Every cold start lands here. The gate decides whether this phone needs an
 * account, a PIN, the rest of setup, or the tabs.
 */
export default function Index() {
  const { user, hasOwner, onboardingComplete, nextOnboardingRoute } = useAuth();

  if (!hasOwner) return <Redirect href="/onboarding/language" />;
  if (!user) return <Redirect href="/sign-in" />;
  if (!onboardingComplete) return <Redirect href={nextOnboardingRoute} />;
  return <Redirect href="/(tabs)" />;
}
