// apps/owner-app/app/(app)/_layout.tsx
// Authenticated shell: dark header matching ops-web, a global logout action
// top-right, and the auth gate (loading spinner / redirect to login / render).
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/use-auth.js';
import { decideAuthGate } from '../../src/auth/auth-gate-policy.js';
import { colors, spacing, radius, fontSize } from '../../src/theme/tokens.js';

function HeaderLogout(): JSX.Element {
  const { logout } = useAuth();
  return (
    <Pressable
      onPress={() => {
        void logout();
      }}
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
      <Text style={{ color: colors.white, fontSize: fontSize.sm, fontWeight: '600' }}>
        Đăng xuất
      </Text>
    </Pressable>
  );
}

export default function AppLayout(): JSX.Element {
  const { status } = useAuth();
  const decision = decideAuthGate(status);

  if (decision === 'show-loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.backdrop,
        }}
      >
        <ActivityIndicator size="large" color={colors.indigo500} />
      </View>
    );
  }
  if (decision === 'redirect-to-login') {
    return <Redirect href="/login" />;
  }
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.slate950 },
        headerTintColor: colors.white,
        headerTitleStyle: { color: colors.white, fontWeight: '700' },
        headerShadowVisible: false,
        headerRight: () => <HeaderLogout />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Tỷ lệ cài đặt' }} />
    </Stack>
  );
}
