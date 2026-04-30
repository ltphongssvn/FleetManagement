// apps/driver-app/app/_layout.tsx
// Root layout for expo-router. Wrapped in Sentry.wrap for navigation/render context.
import { useEffect, useRef, type JSX } from 'react';
import { Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../src/observability/sentry-bootstrap.js';

function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const raw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof raw === 'string' ? raw : undefined);
  }, []);
  return <Stack />;
}

export default Sentry.wrap(RootLayout);
