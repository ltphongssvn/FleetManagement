// apps/driver-app/app/(app)/change-password.tsx
// Driver self-service change-password screen. Mirrors the login screen's form
// pattern (shared tokens, testID + accessibilityLabel on each field/button so
// Maestro can target them by Vietnamese text). Calls the existing
// PasswordChangeClient (POST /driver/me/password with current+new); identity is
// the JWT obtained via useAuth().getAccessToken(), never the body. The API base
// URL resolves through getApiUrl() (the single source of truth shared by web +
// native), exactly like use-auth's login. A 401 surfaces the distinct
// 'current password incorrect' message the client throws; any other failure
// shows a generic error. On success the screen shows 'Đổi mật khẩu thành công'.
import { useState, type JSX } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../src/auth/use-auth.js';
import { PasswordChangeClient } from '../../src/auth/password-change-client.js';
import { getApiUrl } from '../../src/config/api-url.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
export default function ChangePassword(): JSX.Element {
  const { getAccessToken } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = (): void => {
    setError(null);
    setSuccess(false);
    if (currentPassword.length === 0) {
      setError('Vui lòng nhập mật khẩu hiện tại');
      return;
    }
    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        const client = new PasswordChangeClient({ apiUrl: getApiUrl(), bearerToken: () => token });
        await client.changePassword(currentPassword, newPassword);
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Đổi mật khẩu thất bại');
      } finally {
        setBusy(false);
      }
    })();
  };
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.title}>Đổi mật khẩu</Text>
          <Text style={styles.subtitle}>Cập nhật mật khẩu đăng nhập của bạn</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.label}>MẬT KHẨU HIỆN TẠI</Text>
          <TextInput
            testID="Mật khẩu hiện tại"
            style={styles.input}
            placeholder="Nhập mật khẩu hiện tại"
            placeholderTextColor={colors.slate400}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            accessibilityLabel="Mật khẩu hiện tại"
          />
          <Text style={[styles.label, { marginTop: spacing.md }]}>MẬT KHẨU MỚI</Text>
          <TextInput
            testID="Mật khẩu mới"
            style={styles.input}
            placeholder="≥ 6 ký tự"
            placeholderTextColor={colors.slate400}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={newPassword}
            onChangeText={setNewPassword}
            accessibilityLabel="Mật khẩu mới"
          />
          <Pressable
            testID="Lưu mật khẩu"
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              busy && styles.buttonPressed,
            ]}
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Lưu mật khẩu"
          >
            <Text style={styles.buttonText}>{busy ? 'Đang lưu…' : 'Lưu mật khẩu'}</Text>
          </Pressable>
          {success ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>Đổi mật khẩu thành công</Text>
            </View>
          ) : null}
          {error !== null ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
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
  label: {
    ...typography.label,
    color: colors.slate600,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
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
  successBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.indigo50,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  successText: { color: colors.indigo700, fontSize: 13, textAlign: 'center', fontWeight: '600' },
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
