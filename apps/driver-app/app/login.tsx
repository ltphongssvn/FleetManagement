// apps/driver-app/app/login.tsx
// Driver login screen — initiates OIDC PKCE flow via system browser.
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../src/auth/use-auth.js';

export default function Login(): JSX.Element {
  const { status, error, login } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Fleet Driver</Text>
      <Text style={styles.subtitle}>Đăng nhập để xem lệnh điều xe</Text>
      <Pressable style={styles.button} onPress={() => { void login(); }}>
        <Text style={styles.buttonText}>Đăng nhập</Text>
      </Pressable>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 32 },
  button: { backgroundColor: '#0066cc', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c00', marginTop: 16, textAlign: 'center' },
});
