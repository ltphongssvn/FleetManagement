// workers/main-worker/src/intake/intake-policy.ts
// Pure validation functions for upload intake per Frozen Stack PDF
// "intake pipeline (MIME + hash + virus scan + thumbnail); reject -> proof_exception".
//
// Security posture: fail-closed on missing security signals (virus scan, hash
// when one was provided client-side). Fail-open only when a check is genuinely
// not applicable to this upload.

const MIN_SIZE_RATIO = 0.5;
const SIZE_ABS_TOLERANCE_BYTES = 5_000;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
]);

export type IntakeRejectionCode =
  | 'mime_mismatch'
  | 'size_mismatch'
  | 'oversized_file'
  | 'hash_mismatch'
  | 'hash_missing'
  | 'virus_scan_pending'
  | 'virus_detected'
  | 'object_missing';

export interface IntakeInput {
  readonly expectedContentType: string;
  readonly expectedSizeBytes: number;
  readonly maxSizeBytes: number;
  readonly actualContentType: string | null;
  readonly actualSizeBytes: number | null;
  /** Hash provided by client at negotiate-time (null if client did not commit to a hash). */
  readonly providedHash: string | null;
  /** Hash computed by intake worker after S3 download. */
  readonly computedHash: string | null;
  /** null = scan not yet completed (fail-closed); true = clean; false = infected. */
  readonly virusScanClean: boolean | null;
}

export type IntakeDecision =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly rejectionCode: IntakeRejectionCode };

export function validateIntake(input: IntakeInput): IntakeDecision {
  if (input.actualContentType === null || input.actualSizeBytes === null) {
    return { accepted: false, rejectionCode: 'object_missing' };
  }
  if (!ALLOWED_MIME_TYPES.has(input.actualContentType)) {
    return { accepted: false, rejectionCode: 'mime_mismatch' };
  }
  if (input.actualContentType !== input.expectedContentType) {
    return { accepted: false, rejectionCode: 'mime_mismatch' };
  }
  if (input.actualSizeBytes > input.maxSizeBytes) {
    return { accepted: false, rejectionCode: 'oversized_file' };
  }
  // Compression shrinks files; never inflates beyond expected. Lower bound only.
  // Absolute tolerance handles tiny files where ratio test is too strict.
  const absDiff = Math.abs(input.actualSizeBytes - input.expectedSizeBytes);
  const sizeRatio = input.actualSizeBytes / input.expectedSizeBytes;
  if (input.actualSizeBytes > input.expectedSizeBytes + SIZE_ABS_TOLERANCE_BYTES) {
    return { accepted: false, rejectionCode: 'size_mismatch' };
  }
  if (sizeRatio < MIN_SIZE_RATIO && absDiff > SIZE_ABS_TOLERANCE_BYTES) {
    return { accepted: false, rejectionCode: 'size_mismatch' };
  }
  // Fail-closed: if client committed to a hash, intake must verify it.
  if (input.providedHash !== null) {
    if (input.computedHash === null) {
      return { accepted: false, rejectionCode: 'hash_missing' };
    }
    if (input.providedHash !== input.computedHash) {
      return { accepted: false, rejectionCode: 'hash_mismatch' };
    }
  }
  // Fail-closed: virus scan must complete before accept.
  if (input.virusScanClean === null) {
    return { accepted: false, rejectionCode: 'virus_scan_pending' };
  }
  if (!input.virusScanClean) {
    return { accepted: false, rejectionCode: 'virus_detected' };
  }
  return { accepted: true };
}
