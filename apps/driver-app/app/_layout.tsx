// apps/driver-app/app/_layout.tsx
// Root: Sentry + auth gate (redirects unauthenticated to /login) + sync loop.
import { useEffect, useRef, type JSX } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
import { startNativeSyncLoop } from '../src/storage/native-bootstrap.js';
import { useAuth } from '../src/auth/use-auth.js';

const DB_NAME = 'fleet-driver.db';

function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  const { status, getAccessToken } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    const onLogin = segments[0] === 'login';
    if (status === 'unauthenticated' && !onLogin) {
      router.replace('/login');
    } else if (status === 'authenticated' && onLogin) {
      router.replace('/');
    }
  }, [status, segments, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const apiUrlRaw: unknown = process.env['EXPO_PUBLIC_API_URL'];
    if (typeof apiUrlRaw !== 'string' || apiUrlRaw.length === 0) return;
    let cleanup: (() => void) | null = null;
    void startNativeSyncLoop({
      apiUrl: apiUrlRaw,
      dbName: DB_NAME,
      bearerToken: getAccessToken,
    }).then((stop) => { cleanup = stop; }).catch((err: unknown) => {
      Sentry.captureException(err);
    });
    return (): void => { if (cleanup) cleanup(); };
  }, [status, getAccessToken]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default Sentry.wrap(RootLayout);
