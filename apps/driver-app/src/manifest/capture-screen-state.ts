// apps/driver-app/src/manifest/capture-screen-state.ts
// Pure state machine for the manifest-capture screen. No native deps: the
// screen calls expo-image-picker / negotiateAndUploadManifest and feeds
// results in as events; all transition logic lives here so it is unit
// testable without a device. Validation reuses validateCapturedFile so the
// client-side gate matches the upload pipeline exactly.
//
// Multi-warehouse business invariant: every non-error state carries a
// CaptureStop describing which warehouse and which receipt-kind the
// driver is photographing. A parse rejection lands the machine in
// 'invalid_stop' so the presenter renders a localized error with no
// capture button.
import {
  validateCapturedFile,
  type CapturedFile,
  type ManifestRejectionCode,
} from './manifest-capture-policy.js';
import type {
  CaptureStop,
  CaptureStopParseResult,
  CaptureStopRejectionCode,
} from './manifest-capture-stop.js';

export type CaptureState =
  | { readonly phase: 'idle'; readonly stop: CaptureStop }
  | { readonly phase: 'spooled'; readonly stop: CaptureStop; readonly localUri: string; readonly mimeType: string; readonly sizeBytes: number }
  | { readonly phase: 'uploading'; readonly stop: CaptureStop; readonly localUri: string; readonly mimeType: string; readonly sizeBytes: number }
  | { readonly phase: 'done'; readonly stop: CaptureStop; readonly manifestId: string }
  | { readonly phase: 'error'; readonly stop: CaptureStop; readonly message: string; readonly retryable: boolean; readonly rejectionCode?: ManifestRejectionCode }
  | { readonly phase: 'invalid_stop'; readonly rejectionCode: CaptureStopRejectionCode };

export type CaptureEvent =
  | { readonly type: 'PICKED'; readonly file: CapturedFile; readonly localUri: string }
  | { readonly type: 'UPLOAD_START' }
  | { readonly type: 'UPLOAD_OK'; readonly manifestId: string }
  | { readonly type: 'UPLOAD_FAIL'; readonly message: string }
  | { readonly type: 'RESET' };

/** Default stop for legacy callers that don't supply one. Used only by the
 *  zero-arg initialCaptureState(); production code MUST go through
 *  initialCaptureStateForStop() so the machine is anchored to a real
 *  warehouse stop. */
const DEFAULT_STOP: CaptureStop = { kind: 'unloading', stopSequence: null };

export function initialCaptureState(): CaptureState {
  return { phase: 'idle', stop: DEFAULT_STOP };
}

export function initialCaptureStateForStop(parsed: CaptureStopParseResult): CaptureState {
  if (parsed.accepted) {
    return { phase: 'idle', stop: parsed.stop };
  }
  return { phase: 'invalid_stop', rejectionCode: parsed.rejectionCode };
}

export function reduceCapture(state: CaptureState, event: CaptureEvent): CaptureState {
  // invalid_stop is a terminal-until-navigation state: no event can leave it
  // except RESET (which would re-render the route and re-parse params).
  if (state.phase === 'invalid_stop') {
    return state;
  }
  if (event.type === 'RESET') {
    return { phase: 'idle', stop: state.stop };
  }
  if (event.type === 'PICKED') {
    const decision = validateCapturedFile(event.file);
    if (!decision.accepted) {
      return {
        phase: 'error',
        stop: state.stop,
        message: `Tệp không hợp lệ (${decision.rejectionCode})`,
        retryable: true,
        rejectionCode: decision.rejectionCode,
      };
    }
    return {
      phase: 'spooled',
      stop: state.stop,
      localUri: event.localUri,
      mimeType: event.file.mimeType,
      sizeBytes: event.file.sizeBytes,
    };
  }
  if (event.type === 'UPLOAD_START') {
    if (state.phase !== 'spooled') return state;
    return {
      phase: 'uploading',
      stop: state.stop,
      localUri: state.localUri,
      mimeType: state.mimeType,
      sizeBytes: state.sizeBytes,
    };
  }
  if (event.type === 'UPLOAD_OK') {
    if (state.phase !== 'uploading') return state;
    return { phase: 'done', stop: state.stop, manifestId: event.manifestId };
  }
  // event.type === 'UPLOAD_FAIL'
  if (state.phase !== 'uploading') return state;
  return { phase: 'error', stop: state.stop, message: event.message, retryable: true };
}
