// apps/driver-app/app/(auth)/login.tsx
// Driver login screen — phone + password via POST /auth/login.
// Styled with the shared design tokens so it matches ops-web's look.
import { useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/use-auth.js';
import { decideLoginSubmit } from '../../src/auth/login-form-policy.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
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
      <View style={styles.screen}>
        <ActivityIndicator size="large" color={colors.indigo600} />
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
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.title}>Fleet Driver</Text>
          <Text style={styles.subtitle}>Đăng nhập để xem lệnh điều xe</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.label}>SỐ ĐIỆN THOẠI</Text>
          <TextInput
            style={styles.input}
            placeholder="0900000001"
            placeholderTextColor={colors.slate400}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            value={phone}
            onChangeText={setPhone}
            accessibilityLabel="Số điện thoại"
          />
          <Text style={[styles.label, { marginTop: spacing.md }]}>MẬT KHẨU</Text>
          <TextInput
            style={styles.input}
            placeholder="Nhập mật khẩu"
            placeholderTextColor={colors.slate400}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Mật khẩu"
          />
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="Đăng nhập"
          >
            <Text style={styles.buttonText}>Đăng nhập</Text>
          </Pressable>
          {displayError !== null ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{displayError}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backdrop,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.slate200,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardHeader: {
    backgroundColor: colors.indigo50,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: { ...typography.title, color: colors.slate900 },
  subtitle: { ...typography.caption, color: colors.slate500, marginTop: spacing.xs },
  cardBody: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  label: { ...typography.label, color: colors.slate600, textTransform: 'uppercase', marginBottom: spacing.xs },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.slate900,
    backgroundColor: colors.white,
  },
  button: {
    backgroundColor: colors.indigo600,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonPressed: { backgroundColor: colors.indigo700 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  errorBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.red50,
    borderWidth: 1,
    borderColor: colors.red200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { color: colors.red700, fontSize: 13, textAlign: 'center' },
});
