import { Redirect } from 'expo-router';
import { useGateRoute } from '@/auth/gate';

/**
 * Every cold start lands here. The gate decides whether this phone needs an
 * account, a PIN, a new email login, the rest of setup, a waiting screen for
 * restored shop data, or the tabs.
 */
export default function Index() {
  return <Redirect href={useGateRoute()} />;
}
