// apps/driver-app/app/_layout.tsx
// Root layout: Sentry + (native-only) sync loop. Web build uses .web.ts stub.
import { useEffect, useRef, type JSX } from 'react';
import { Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
import { startNativeSyncLoop } from '../src/storage/native-bootstrap.js';

const DB_NAME = 'fleet-driver.db';

function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);
    const apiUrlRaw: unknown = process.env['EXPO_PUBLIC_FLEET_API_URL'];
    if (typeof apiUrlRaw !== 'string' || apiUrlRaw.length === 0) return;
    let cleanup: (() => void) | null = null;
    void startNativeSyncLoop({
      apiUrl: apiUrlRaw,
      dbName: DB_NAME,
      bearerToken: (): string => {
        const t: unknown = process.env['EXPO_PUBLIC_FLEET_API_TOKEN'];
        return typeof t === 'string' ? t : '';
      },
    }).then((stop) => { cleanup = stop; }).catch((err: unknown) => {
      Sentry.captureException(err);
    });
    return (): void => { if (cleanup) cleanup(); };
  }, []);
  return <Stack />;
}
export default Sentry.wrap(RootLayout);
