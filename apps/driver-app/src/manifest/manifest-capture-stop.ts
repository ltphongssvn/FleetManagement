// apps/driver-app/src/manifest/manifest-capture-stop.ts
// Pure parser/validator for the capture-screen stop descriptor. Encodes the
// permanent business invariant for multi-warehouse manifest capture:
//   - 1..4 loading warehouses (stopIndex 0..3, displayed as 1..4)
//   - exactly 1 unloading warehouse
// No native deps. Inputs come from expo-router useLocalSearchParams as
// strings (or undefined), so the parser accepts the raw shape and emits a
// typed CaptureStop or a typed rejection code the presenter can localize.

/** Hard upper bound on loading warehouses per journey. */
export const MAX_LOADING_WAREHOUSES = 4 as const;

export type CaptureStopKind = 'loading' | 'unloading';

export type CaptureStop =
  | { readonly kind: 'loading'; readonly stopIndex: number; readonly displayIndex: number }
  | { readonly kind: 'unloading' };

export type CaptureStopRejectionCode =
  | 'stop_kind_missing'
  | 'stop_kind_invalid'
  | 'loading_index_missing'
  | 'loading_index_invalid'
  | 'loading_index_out_of_range';

export interface CaptureStopParams {
  readonly stopKind?: string | undefined;
  readonly stopIndex?: string | undefined;
}

export type CaptureStopParseResult =
  | { readonly accepted: true; readonly stop: CaptureStop }
  | { readonly accepted: false; readonly rejectionCode: CaptureStopRejectionCode };

function accept(stop: CaptureStop): CaptureStopParseResult {
  return { accepted: true, stop };
}

function reject(code: CaptureStopRejectionCode): CaptureStopParseResult {
  return { accepted: false, rejectionCode: code };
}

export function parseCaptureStop(params: CaptureStopParams): CaptureStopParseResult {
  const kindRaw = params.stopKind;
  if (kindRaw === undefined || kindRaw.length === 0) {
    return reject('stop_kind_missing');
  }
  if (kindRaw === 'unloading') {
    // Exactly one unloading warehouse per journey; any stopIndex is ignored.
    return accept({ kind: 'unloading' });
  }
  if (kindRaw !== 'loading') {
    return reject('stop_kind_invalid');
  }
  const idxRaw = params.stopIndex;
  if (idxRaw === undefined || idxRaw.length === 0) {
    return reject('loading_index_missing');
  }
  // Strict integer parse: reject '1.5', 'abc', '1e2', '  1', etc.
  if (!/^-?\d+$/.test(idxRaw)) {
    return reject('loading_index_invalid');
  }
  const idx = Number.parseInt(idxRaw, 10);
  if (!Number.isSafeInteger(idx)) {
    return reject('loading_index_invalid');
  }
  if (idx < 0 || idx >= MAX_LOADING_WAREHOUSES) {
    return reject('loading_index_out_of_range');
  }
  return accept({ kind: 'loading', stopIndex: idx, displayIndex: idx + 1 });
}
