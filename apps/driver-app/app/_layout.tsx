// apps/driver-app/app/_layout.tsx
import { useEffect, useRef, type JSX } from 'react';
import { Slot } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../src/observability/sentry-bootstrap.js';

function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);
  }, []);
  return <Slot />;
}

export default Sentry.wrap(RootLayout);
