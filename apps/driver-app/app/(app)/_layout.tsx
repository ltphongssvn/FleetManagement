// apps/driver-app/app/(app)/_layout.tsx
// Authenticated app shell. Every screen gets a consistent header (matching
// ops-web's dark nav bar) with a global logout button in headerRight, so
// logout is reachable from any screen - the conventional mobile pattern.
import { useEffect, type JSX } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { startNativeSyncLoop } from '../../src/storage/native-bootstrap.js';
import { useAuth } from '../../src/auth/use-auth.js';
import { decideAuthGate } from '../../src/auth/auth-gate-policy.js';
import { colors, spacing, radius } from '../../src/theme/tokens.js';
const DB_NAME = 'fleet-driver.db';
// Global header logout — rendered top-right on every (app) screen.
function HeaderLogout(): JSX.Element {
  const { logout } = useAuth();
  return (
    <Pressable
      onPress={() => { void logout(); }}
      accessibilityRole="button"
      accessibilityLabel="Đăng xuất"
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.25)',
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          marginRight: spacing.sm,
        },
        pressed && { backgroundColor: 'rgba(255,255,255,0.1)' },
      ]}
    >
      <Text style={{ color: colors.white, fontSize: 13, fontWeight: '600' }}>Đăng xuất</Text>
    </Pressable>
  );
}
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backdrop }}>
        <ActivityIndicator size="large" color={colors.indigo500} />
      </View>
    );
  }
  if (decision === 'redirect-to-login') {
    return <Redirect href="/login" />;
  }
  // Consistent dark header on every screen: title + back button + a global
  // logout action top-right. Matches ops-web's persistent nav bar.
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.slate950 },
        headerTintColor: colors.white,
        headerTitleStyle: { color: colors.white, fontWeight: '700' },
        headerBackTitle: 'Quay lại',
        headerShadowVisible: false,
        headerRight: () => <HeaderLogout />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Ứng dụng Tài xế' }} />
      <Stack.Screen name="assignments" options={{ title: 'Lệnh điều xe' }} />
      <Stack.Screen name="history" options={{ title: 'Lịch sử chuyến' }} />
      <Stack.Screen name="completed" options={{ title: 'Lệnh đã hoàn thành' }} />
      <Stack.Screen name="commands" options={{ title: 'Lệnh điều phối' }} />
      <Stack.Screen name="capture" options={{ title: 'Chụp ảnh phiếu giao hàng' }} />
    </Stack>
  );
}
