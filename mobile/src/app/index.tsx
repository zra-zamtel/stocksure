import { Redirect } from 'expo-router';

// Barebone shortcut: go straight to the tabs so the app is usable on every
// reload. The real first-run gate (no owner yet -> onboarding) belongs with
// issue #10, once the local database knows whether an account exists.
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
