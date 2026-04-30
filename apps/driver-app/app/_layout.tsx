// apps/driver-app/app/_layout.tsx
// Root layout for expo-router. Initializes Sentry once via useEffect to avoid
// import-time side effects (which break HMR and pollute test runs).
import { useEffect, useRef, type JSX } from 'react';
import { Stack } from 'expo-router';
import { initSentry } from '../src/observability/sentry-bootstrap.js';

export default function RootLayout(): JSX.Element {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const raw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof raw === 'string' ? raw : undefined);
  }, []);
  return <Stack />;
}
