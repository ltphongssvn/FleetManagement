// apps/driver-app/app/_layout.tsx
// IMPORTANT: install the expo/fetch polyfill FIRST, before any other import,
// so the global fetch is replaced before any module that performs (or captures)
// a network request loads. Fixes the RN 0.83 / SDK 55 Bridgeless whatwg-fetch
// "Network request failed" regression. See install-fetch-polyfill.ts.
import '../src/polyfills/install-fetch-polyfill.js';
import { useEffect, useRef, type JSX } from 'react';
import { Slot, useRouter, type Href } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
import { AuthProvider } from '../src/auth/use-auth.js';
import { createQueryClient } from '../src/data/query-client.js';
// Native alert wiring lives behind a coverage-excluded adapter (renders real
// expo-notifications), imported directly like startNativeSyncLoop. The pure
// decision + setup policies it calls are unit-tested; this file only WIRES them.
import {
  setUpDriverAlerts,
  subscribeNotificationTaps,
  drainInitialNotificationResponse,
} from '../src/push/notification-setup-native.js';
// One QueryClient for the whole app lifetime — created at module scope
// so it is stable across re-renders of RootLayout.
const queryClient = createQueryClient();
function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);
  }, []);
  // Driver alert wiring. Deliberately at the ROOT layout, ABOVE the auth gate:
  // an alert can arrive while the app is killed and the driver is logged out
  // (token still valid server-side). The channel and tap handling must exist
  // from first launch, or a 4AM tap from a cold, logged-out app has no channel
  // to ring through and nowhere to route the tap.
  useEffect(() => {
    const navigate = (href: string): void => { router.push(href as Href); };
    // (1) Boot bring-up: foreground handler + channel-first setup + token.
    //     Fire-and-forget -- a slow or denied permission prompt must never
    //     block first paint. Errors are reported, not thrown into render.
    void setUpDriverAlerts().catch((err: unknown) => { Sentry.captureException(err); });
    // (2) Live taps (app foreground/background): register the response listener
    //     FIRST. Expo only reliably returns the last response once a listener
    //     exists (expo/expo#36930, #37511), so this must precede the drain.
    const subscription = subscribeNotificationTaps(navigate);
    // (3) Cold-start tap (app KILLED, launched BY the tap): the listener above
    //     never fires for this case. getLastNotificationResponse is synchronous
    //     in SDK 55, so the initial response is read and routed immediately --
    //     no async gap, no unmount race.
    drainInitialNotificationResponse(navigate);
    return (): void => { subscription.remove(); };
  }, [router]);
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
