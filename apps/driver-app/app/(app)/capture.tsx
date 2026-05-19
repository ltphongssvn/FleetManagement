// apps/driver-app/app/(app)/capture.tsx
// Manifest-photo capture screen. Thin shell: expo-image-picker -> reduceCapture
// -> negotiateAndUploadManifest -> presentCapture(state). All logic lives in
// the tested pure modules (capture-screen-state / -presenter). Vietnamese UI.
// Styled with the shared design tokens to match ops-web.
import { useReducer, useState, type JSX } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../src/auth/use-auth.js';
import {
  initialCaptureState,
  reduceCapture,
  type CaptureEvent,
  type CaptureState,
} from '../../src/manifest/capture-screen-state.js';
import { presentCapture } from '../../src/manifest/capture-screen-presenter.js';
import { negotiateAndUploadManifest } from '../../src/manifest/manifest-capture-flow.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
import { getApiUrl } from '../../src/config/api-url.js';
function mimeFromUri(uri: string): 'image/jpeg' | 'image/png' {
  return uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}
export default function Capture(): JSX.Element {
  const [state, dispatch] = useReducer(
    (s: CaptureState, e: CaptureEvent) => reduceCapture(s, e),
    undefined,
    initialCaptureState,
  );
  const { getAccessToken } = useAuth();
  // The order this delivery photo belongs to, passed as a route param
  // (e.g. /capture?transportOrderId=<uuid>) from the assignment card.
  const params = useLocalSearchParams<{ transportOrderId?: string }>();
  const transportOrderId = typeof params.transportOrderId === 'string'
    ? params.transportOrderId
    : null;
  const [picked, setPicked] = useState<{ uri: string; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' } | null>(null);
  const vm = presentCapture(state);
  const takePhoto = async (): Promise<void> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      dispatch({ type: 'PICKED', file: { mimeType: 'denied', sizeBytes: 0 }, localUri: '' });
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset === undefined) return;
    const resp = await fetch(asset.uri);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const mime = mimeFromUri(asset.uri);
    setPicked({ uri: asset.uri, bytes: buf, mime });
    dispatch({ type: 'PICKED', file: { mimeType: mime, sizeBytes: buf.byteLength }, localUri: asset.uri });
  };
  const upload = async (): Promise<void> => {
    if (picked === null) return;
    if (transportOrderId === null) {
      dispatch({ type: 'UPLOAD_FAIL', message: 'Thiếu mã đơn hàng' });
      return;
    }
    dispatch({ type: 'UPLOAD_START' });
    try {
      const result = await negotiateAndUploadManifest({
        apiUrl: getApiUrl(),
        bearerToken: getAccessToken,
        manifestCorrelationId: randomUUID(),
        transportOrderId,
        contentType: picked.mime,
        fileBytes: picked.bytes,
      });
      dispatch({ type: 'UPLOAD_OK', manifestId: result.manifestId });
    } catch (e) {
      dispatch({ type: 'UPLOAD_FAIL', message: e instanceof Error ? e.message : 'upload error' });
    }
  };
  return (
    <View style={styles.screen} testID={vm.testID}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.title}>{vm.title}</Text>
          <Text style={styles.status}>{vm.statusText}</Text>
        </View>
        <View style={styles.cardBody}>
          {vm.previewUri !== null ? (
            <Image source={{ uri: vm.previewUri }} style={styles.preview} resizeMode={'contain'} />
          ) : null}
          {vm.busy ? <ActivityIndicator size={'large'} color={colors.indigo600} style={styles.spin} /> : null}
          {vm.captureButton.visible ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.indigo600 },
                vm.captureButton.disabled ? styles.disabled : null,
                pressed && styles.pressed,
              ]}
              disabled={vm.captureButton.disabled}
              onPress={() => { void takePhoto(); }}
              accessibilityRole={'button'}
              accessibilityLabel={vm.captureButton.label}
            >
              <Text style={styles.buttonText}>{vm.captureButton.label}</Text>
            </Pressable>
          ) : null}
          {vm.uploadButton.visible ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.green600 },
                vm.uploadButton.disabled ? styles.disabled : null,
                pressed && styles.pressed,
              ]}
              disabled={vm.uploadButton.disabled}
              onPress={() => { void upload(); }}
              accessibilityRole={'button'}
              accessibilityLabel={vm.uploadButton.label}
            >
              <Text style={styles.buttonText}>{vm.uploadButton.label}</Text>
            </Pressable>
          ) : null}
          {vm.resetButton.visible ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.resetButton,
                pressed && styles.pressed,
              ]}
              onPress={() => { setPicked(null); dispatch({ type: 'RESET' }); }}
              accessibilityRole={'button'}
              accessibilityLabel={vm.resetButton.label}
            >
              <Text style={styles.resetButtonText}>{vm.resetButton.label}</Text>
            </Pressable>
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
  title: { ...typography.title, color: colors.slate900, textAlign: 'center' },
  status: { ...typography.caption, color: colors.slate500, marginTop: spacing.xs, textAlign: 'center' },
  cardBody: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, alignItems: 'center' },
  preview: {
    width: 240,
    height: 320,
    marginBottom: spacing.lg,
    backgroundColor: colors.backdrop,
    borderRadius: radius.lg,
  },
  spin: { marginBottom: spacing.lg },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    minWidth: 240,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: colors.red50,
    borderWidth: 1,
    borderColor: colors.red200,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  resetButtonText: { color: colors.red700, fontSize: 16, fontWeight: '600' },
});
