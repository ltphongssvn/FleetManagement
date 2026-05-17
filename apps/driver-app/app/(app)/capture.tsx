// apps/driver-app/app/(app)/capture.tsx
// Manifest-photo capture screen. Thin shell: expo-image-picker -> reduceCapture
// -> negotiateAndUploadManifest -> presentCapture(state). All logic lives in
// the tested pure modules (capture-screen-state / -presenter). Vietnamese UI.
import { useReducer, useState, type JSX } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/auth/use-auth.js';
import {
  initialCaptureState,
  reduceCapture,
  type CaptureEvent,
  type CaptureState,
} from '../../src/manifest/capture-screen-state.js';
import { presentCapture } from '../../src/manifest/capture-screen-presenter.js';
import { negotiateAndUploadManifest } from '../../src/manifest/manifest-capture-flow.js';

function getApiUrl(): string {
  return (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ?? 'http://localhost:3000';
}

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
  const [picked, setPicked] = useState<{ uri: string; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' } | null>(null);
  const vm = presentCapture(state);

  const takePhoto = async (): Promise<void> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      dispatch({ type: 'PICKED', file: { mimeType: 'denied', sizeBytes: 0 }, localUri: '' });
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (res.canceled || res.assets.length === 0) return;
    const asset = res.assets[0];
    const resp = await fetch(asset.uri);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const mime = mimeFromUri(asset.uri);
    setPicked({ uri: asset.uri, bytes: buf, mime });
    dispatch({ type: 'PICKED', file: { mimeType: mime, sizeBytes: buf.byteLength }, localUri: asset.uri });
  };

  const upload = async (): Promise<void> => {
    if (picked === null) return;
    dispatch({ type: 'UPLOAD_START' });
    try {
      const result = await negotiateAndUploadManifest({
        apiUrl: getApiUrl(),
        bearerToken: getAccessToken,
        manifestCorrelationId: `cap-${String(Date.now())}`,
        transportOrderId: 'pending',
        contentType: picked.mime,
        fileBytes: picked.bytes,
      });
      dispatch({ type: 'UPLOAD_OK', manifestId: result.manifestId });
    } catch (e) {
      dispatch({ type: 'UPLOAD_FAIL', message: e instanceof Error ? e.message : 'upload error' });
    }
  };

  return (
    <View style={styles.center} testID={vm.testID}>
      <Text style={styles.title}>{vm.title}</Text>
      <Text style={styles.status}>{vm.statusText}</Text>
      {vm.previewUri !== null ? (
        <Image source={{ uri: vm.previewUri }} style={styles.preview} resizeMode={'contain'} />
      ) : null}
      {vm.busy ? <ActivityIndicator size={'large'} style={styles.spin} /> : null}
      {vm.captureButton.visible ? (
        <Pressable
          style={[styles.button, vm.captureButton.disabled ? styles.disabled : null]}
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
          style={[styles.button, styles.upload, vm.uploadButton.disabled ? styles.disabled : null]}
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
          style={[styles.button, styles.reset]}
          onPress={() => { setPicked(null); dispatch({ type: 'RESET' }); }}
          accessibilityRole={'button'}
          accessibilityLabel={vm.resetButton.label}
        >
          <Text style={styles.buttonText}>{vm.resetButton.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  status: { fontSize: 14, color: '#555', marginBottom: 20, textAlign: 'center' },
  preview: { width: 240, height: 320, marginBottom: 20, backgroundColor: '#f2f2f2', borderRadius: 8 },
  spin: { marginBottom: 20 },
  button: { backgroundColor: '#0066cc', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, marginTop: 10, minWidth: 220, alignItems: 'center' },
  upload: { backgroundColor: '#10b981' },
  reset: { backgroundColor: '#6b7280' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
