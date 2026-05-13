// apps/driver-app/app/(auth)/login.tsx
// Driver login screen — phone + password via POST /auth/login.
import { useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../src/auth/use-auth.js';

export default function Login(): JSX.Element {
  const { status, error, login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const submit = (): void => {
    if (phone.length === 0 || password.length === 0) return;
    void login(phone, password);
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Fleet Driver</Text>
      <Text style={styles.subtitle}>Đăng nhập để xem lệnh điều xe</Text>
      <TextInput
        style={styles.input}
        placeholder="Số điện thoại"
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoCorrect={false}
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="Mật khẩu"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.button} onPress={submit}>
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
  input: { width: '100%', maxWidth: 320, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#0066cc', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c00', marginTop: 16, textAlign: 'center' },
});
