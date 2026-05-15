// apps/driver-app/app/(auth)/login.tsx
// Driver login screen — phone + password via POST /auth/login.
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/use-auth.js';
import { decideLoginSubmit } from '../../src/auth/login-form-policy.js';

export default function Login(): JSX.Element {
  const { status, error, login } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Post-success navigation: when auth state flips to 'authenticated' while
  // on /login, push the user into the (app) group so the home screen renders.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const submit = (): void => {
    const decision = decideLoginSubmit(phone, password);
    if (decision.kind === 'missing-phone') {
      setLocalError('Vui lòng nhập số điện thoại');
      return;
    }
    if (decision.kind === 'missing-password') {
      setLocalError('Vui lòng nhập mật khẩu');
      return;
    }
    setLocalError(null);
    void login(decision.phone, decision.password);
  };

  const displayError = localError ?? error;

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Fleet Driver</Text>
      <Text style={styles.subtitle}>Đăng nhập để xem lệnh điều xe</Text>
      <Text style={styles.label}>Số điện thoại</Text>
      <TextInput
        style={styles.input}
        placeholder="0900000001"
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoCorrect={false}
        value={phone}
        onChangeText={setPhone}
        accessibilityLabel="Số điện thoại"
      />
      <Text style={styles.label}>Mật khẩu</Text>
      <TextInput
        style={styles.input}
        placeholder="Nhập mật khẩu"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
        accessibilityLabel="Mật khẩu"
      />
      <Pressable
        style={styles.button}
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel="Đăng nhập"
      >
        <Text style={styles.buttonText}>Đăng nhập</Text>
      </Pressable>
      {displayError !== null ? <Text style={styles.error}>{displayError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 32 },
  label: { alignSelf: 'flex-start', maxWidth: 320, width: '100%', fontSize: 13, color: '#444', marginBottom: 4, fontWeight: '600' },
  input: { width: '100%', maxWidth: 320, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 16, backgroundColor: '#fff' },
  button: { backgroundColor: '#0066cc', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c00', marginTop: 16, textAlign: 'center', maxWidth: 320 },
});
