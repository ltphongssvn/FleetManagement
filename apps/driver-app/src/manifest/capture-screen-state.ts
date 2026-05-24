// apps/driver-app/src/manifest/capture-screen-state.ts
// Pure state machine for the manifest-capture screen. No native deps: the
// screen calls expo-image-picker / negotiateAndUploadManifest and feeds
// results in as events; all transition logic lives here so it is unit
// testable without a device. Validation reuses validateCapturedFile so the
// client-side gate matches the upload pipeline exactly.
import {
  validateCapturedFile,
  type CapturedFile,
  type ManifestRejectionCode,
} from './manifest-capture-policy.js';

export type CaptureState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'spooled'; readonly localUri: string; readonly mimeType: string; readonly sizeBytes: number }
  | { readonly phase: 'uploading'; readonly localUri: string; readonly mimeType: string; readonly sizeBytes: number }
  | { readonly phase: 'done'; readonly manifestId: string }
  | { readonly phase: 'error'; readonly message: string; readonly retryable: boolean; readonly rejectionCode?: ManifestRejectionCode };

export type CaptureEvent =
  | { readonly type: 'PICKED'; readonly file: CapturedFile; readonly localUri: string }
  | { readonly type: 'UPLOAD_START' }
  | { readonly type: 'UPLOAD_OK'; readonly manifestId: string }
  | { readonly type: 'UPLOAD_FAIL'; readonly message: string }
  | { readonly type: 'RESET' };

export function initialCaptureState(): CaptureState {
  return { phase: 'idle' };
}

export function reduceCapture(state: CaptureState, event: CaptureEvent): CaptureState {
  if (event.type === 'RESET') {
    return { phase: 'idle' };
  }
  if (event.type === 'PICKED') {
    const decision = validateCapturedFile(event.file);
    if (!decision.accepted) {
      return {
        phase: 'error',
        message: `Tệp không hợp lệ (${decision.rejectionCode})`,
        retryable: true,
        rejectionCode: decision.rejectionCode,
      };
    }
    return {
      phase: 'spooled',
      localUri: event.localUri,
      mimeType: event.file.mimeType,
      sizeBytes: event.file.sizeBytes,
    };
  }
  if (event.type === 'UPLOAD_START') {
    if (state.phase !== 'spooled') return state;
    return { phase: 'uploading', localUri: state.localUri, mimeType: state.mimeType, sizeBytes: state.sizeBytes };
  }
  if (event.type === 'UPLOAD_OK') {
    if (state.phase !== 'uploading') return state;
    return { phase: 'done', manifestId: event.manifestId };
  }
  // event.type === 'UPLOAD_FAIL' (only remaining variant after the guards above)
  if (state.phase !== 'uploading') return state;
  return { phase: 'error', message: event.message, retryable: true };
}
