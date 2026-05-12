// apps/driver-app/app/(app)/_layout.tsx
import { useEffect, type JSX } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { startNativeSyncLoop } from '../../src/storage/native-bootstrap.js';
import { useAuth } from '../../src/auth/use-auth.js';
import { decideAuthGate } from '../../src/auth/auth-gate-policy.js';

const DB_NAME = 'fleet-driver.db';

export default function AppLayout(): JSX.Element {
  const { status, getAccessToken } = useAuth();
  const decision = decideAuthGate(status);

  useEffect(() => {
    if (decision !== 'render-app') return;
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
  }, [decision, getAccessToken]);

  if (decision === 'show-loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (decision === 'redirect-to-login') {
    return <Redirect href="/login" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
