// apps/owner-app/app/(auth)/login.tsx
// Owner login screen. A single button opens the Keycloak system-browser flow
// (Authorization Code + PKCE) via useAuth().login(); on success the auth gate
// flips and the router shows the dashboard. Vietnamese UI.
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth/use-auth.js';
import { colors, spacing, radius, fontSize } from '../../src/theme/tokens.js';

export default function LoginScreen(): JSX.Element {
  const { status, error, login } = useAuth();

  if (status === 'authenticated') {
    return <Redirect href="/" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <Text style={{ color: colors.white, fontSize: fontSize.xxl, fontWeight: '800', marginBottom: spacing.sm }}>
        Fleet Owner
      </Text>
      <Text style={{ color: colors.slate400, fontSize: fontSize.base, marginBottom: spacing.xxl, textAlign: 'center' }}>
        Bảng điều khiển tỷ lệ tài xế đã cài đặt ứng dụng
      </Text>

      {status === 'loading' ? (
        <ActivityIndicator size="large" color={colors.indigo500} />
      ) : (
        <Pressable
          onPress={() => { void login(); }}
          accessibilityRole="button"
          accessibilityLabel="Đăng nhập"
          style={({ pressed }) => [
            { backgroundColor: colors.indigo600, borderRadius: radius.lg, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, minWidth: 200, alignItems: 'center' },
            pressed && { backgroundColor: colors.indigo700 },
          ]}
        >
          <Text style={{ color: colors.white, fontSize: fontSize.lg, fontWeight: '700' }}>Đăng nhập</Text>
        </Pressable>
      )}

      {error !== null ? (
        <Text style={{ color: colors.red200, fontSize: fontSize.sm, marginTop: spacing.lg, textAlign: 'center' }}>{error}</Text>
      ) : null}
    </View>
  );
}
