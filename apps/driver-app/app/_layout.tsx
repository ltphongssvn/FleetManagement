// apps/driver-app/app/_layout.tsx
import { useEffect, useRef, type JSX } from 'react';
import { Slot } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
import { AuthProvider } from '../src/auth/use-auth.js';
import { createQueryClient } from '../src/data/query-client.js';
// One QueryClient for the whole app lifetime — created at module scope
// so it is stable across re-renders of RootLayout.
const queryClient = createQueryClient();
function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);
  }, []);
  // AuthProvider holds the single shared auth state for the whole app, so
  // logout() on one screen flips the auth gate on every other screen.
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Slot />
      </AuthProvider>
    </QueryClientProvider>
  );
}
export default Sentry.wrap(RootLayout);
