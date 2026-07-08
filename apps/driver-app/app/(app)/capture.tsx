// apps/driver-app/app/(app)/capture.tsx
// Manifest-photo capture screen. Thin shell: parseCaptureStop -> stop-aware
// initial state -> expo-image-picker -> reduceCapture ->
// negotiateAndUploadManifest -> presentCapture(state). All logic lives in
// the tested pure modules (manifest-capture-stop / capture-screen-state /
// capture-screen-presenter). Vietnamese UI. Styled with the shared design
// tokens to match ops-web.
//
// Multi-warehouse business invariant: the route receives stopKind=loading
// (with stopIndex 0..3 for warehouses 1..4) or stopKind=unloading (no
// index). Any invalid stop param drops the screen into an error view with
// no capture button - the screen cannot be used to take a photo that
// would violate the invariant.
import { useReducer, useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../src/auth/use-auth.js';
import {
  initialCaptureStateForStop,
  reduceCapture,
  type CaptureEvent,
  type CaptureState,
} from '../../src/manifest/capture-screen-state.js';
import { presentCapture } from '../../src/manifest/capture-screen-presenter.js';
import { negotiateAndUploadManifest } from '../../src/manifest/manifest-capture-flow.js';
import { parseCaptureStop } from '../../src/manifest/manifest-capture-stop.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
import { getApiUrl } from '../../src/config/api-url.js';
import { DeliveryLifecycleClient } from '../../src/assignments/delivery-lifecycle-client.js';
import { makeForgivingLifecycleMutationFn } from '../../src/assignments/forgiving-lifecycle.js';
import { autoAdvanceAfterCapture } from '../../src/assignments/auto-advance-after-capture.js';
import { ASSIGNMENTS_QUERY_KEY } from '../../src/assignments/assignments-query.js';

function mimeFromUri(uri: string): 'image/jpeg' | 'image/png' {
  return uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

function strParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export default function Capture(): JSX.Element {
  // The order this delivery photo belongs to, plus the multi-warehouse stop
  // descriptor (which warehouse + which receipt-kind). Passed as route params
  // (e.g. /capture?transportOrderId=<uuid>&stopKind=loading&stopIndex=2)
  // from the assignment card.
  const params = useLocalSearchParams<{
    transportOrderId?: string;
    stopKind?: string;
    stopIndex?: string;
    stopSequence?: string;
    roadRunId?: string;
    runState?: string;
    remaining?: string;
  }>();
  const transportOrderId = strParam(params.transportOrderId) ?? null;
  // driver-min-interaction: run context for photo-implies-progress.
  const roadRunId = strParam(params.roadRunId) ?? null;
  const runState = strParam(params.runState) ?? null;
  const remainingRaw = strParam(params.remaining);
  const remaining = remainingRaw !== undefined ? Number(remainingRaw) : null;
  const stopParse = parseCaptureStop({
    stopKind: strParam(params.stopKind),
    stopIndex: strParam(params.stopIndex),
    stopSequence: strParam(params.stopSequence),
  });

  const [state, dispatch] = useReducer(
    (s: CaptureState, e: CaptureEvent) => reduceCapture(s, e),
    stopParse,
    initialCaptureStateForStop,
  );
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();

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
        ...(state.phase !== 'invalid_stop' && state.stop.stopSequence !== null
          ? { stopSequence: state.stop.stopSequence }
          : {}),
      });
      dispatch({ type: 'UPLOAD_OK', manifestId: result.manifestId });
      // Photo IS the signal: fire-and-forget lifecycle auto-advance through
      // the forgiving factory. Never blocks or banners the photo flow; the
      // assignments refetch shows truth and its button stays the fallback.
      if (roadRunId !== null && runState !== null && remaining !== null) {
        const lifecycleFn = makeForgivingLifecycleMutationFn(
          new DeliveryLifecycleClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken }),
        );
        // Await the advance, then invalidate the assignments query so the
        // list badge reflects the new state on return (the mutation runs on a
        // separate client here, so without this the list stays stale even on
        // a successful advance). Errors are still swallowed inside the bridge.
        void autoAdvanceAfterCapture(
          { roadRunId, runState, remainingBeforeThisUpload: remaining },
          lifecycleFn,
        ).then((fired) => {
          if (fired !== null) {
            void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_QUERY_KEY });
          }
        });
      }
    } catch (e) {
      dispatch({ type: 'UPLOAD_FAIL', message: e instanceof Error ? e.message : 'upload error' });
    }
  };

  return (
    <View style={styles.screen} testID={vm.testID}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text
            accessibilityRole={'header'}
            // RNW maps accessibilityRole=header to <h1>, which Playwright's
            // getByRole('heading') matches. Title is anchored to the stop
            // descriptor by presentCapture().
            style={styles.title}
          >
            {vm.title}
          </Text>
          <Text style={styles.status}>{vm.statusText}</Text>
          {vm.stopKind !== null ? (
            <Text testID={'capture-stop-kind'} style={styles.metaHidden}>{vm.stopKind}</Text>
          ) : null}
          {vm.stopDisplayIndex !== null ? (
            <Text testID={'capture-stop-index'} style={styles.metaHidden}>
              {String(vm.stopDisplayIndex)}
            </Text>
          ) : null}
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
  // Visually hidden but present in the DOM for Playwright getByTestId.
  metaHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
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
