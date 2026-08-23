// workers/main-worker/src/intake/intake-policy.ts
// Pure validation functions for upload intake per Frozen Stack PDF
// "intake pipeline (MIME + hash + virus scan + thumbnail); reject -> proof_exception".
//
// Security posture: fail-closed on missing security signals (virus scan, hash
// when one was provided client-side). Defensive numeric validation guards
// against impossible inputs (NaN, negative, zero expectedSize).
import { ALLOWED_MANIFEST_MIME_TYPES } from '@fleet/sync-protocol';

const MIN_SIZE_RATIO = 0.5;
const SIZE_ABS_TOLERANCE_BYTES = 5_000;
const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(
  ALLOWED_MANIFEST_MIME_TYPES as readonly string[],
);

export const INTAKE_POLICY_VERSION = 'intake-policy-v1' as const;

export type IntakeRejectionCode =
  | 'invalid_input'
  | 'unsupported_mime_type'
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
  readonly providedHash: string | null;
  readonly computedHash: string | null;
  readonly virusScanClean: boolean | null;
}

export type IntakeDecision =
  | { readonly accepted: true; readonly policyVersion: typeof INTAKE_POLICY_VERSION }
  | {
      readonly accepted: false;
      readonly rejectionCode: IntakeRejectionCode;
      readonly policyVersion: typeof INTAKE_POLICY_VERSION;
    };

function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function isNonNegativeFinite(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

export function validateIntake(input: IntakeInput): IntakeDecision {
  // Defensive: reject impossible numeric inputs even though DTOs catch most.
  if (!isPositiveFinite(input.expectedSizeBytes) || !isPositiveFinite(input.maxSizeBytes)) {
    return {
      accepted: false,
      rejectionCode: 'invalid_input',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (input.actualContentType === null || input.actualSizeBytes === null) {
    return {
      accepted: false,
      rejectionCode: 'object_missing',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (!isNonNegativeFinite(input.actualSizeBytes)) {
    return {
      accepted: false,
      rejectionCode: 'invalid_input',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (!ALLOWED_MIME_SET.has(input.actualContentType)) {
    return {
      accepted: false,
      rejectionCode: 'unsupported_mime_type',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (input.actualContentType !== input.expectedContentType) {
    return {
      accepted: false,
      rejectionCode: 'mime_mismatch',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (input.actualSizeBytes > input.maxSizeBytes) {
    return {
      accepted: false,
      rejectionCode: 'oversized_file',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  // Compression shrinks files; never inflates beyond expected. Lower bound only.
  // Absolute tolerance handles tiny files where ratio test is too strict.
  const absDiff = Math.abs(input.actualSizeBytes - input.expectedSizeBytes);
  const sizeRatio = input.actualSizeBytes / input.expectedSizeBytes;
  if (input.actualSizeBytes > input.expectedSizeBytes + SIZE_ABS_TOLERANCE_BYTES) {
    return {
      accepted: false,
      rejectionCode: 'size_mismatch',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (sizeRatio < MIN_SIZE_RATIO && absDiff > SIZE_ABS_TOLERANCE_BYTES) {
    return {
      accepted: false,
      rejectionCode: 'size_mismatch',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  // Fail-closed: if client committed to a hash, intake must verify it.
  if (input.providedHash !== null) {
    if (input.computedHash === null) {
      return {
        accepted: false,
        rejectionCode: 'hash_missing',
        policyVersion: INTAKE_POLICY_VERSION,
      };
    }
    if (input.providedHash !== input.computedHash) {
      return {
        accepted: false,
        rejectionCode: 'hash_mismatch',
        policyVersion: INTAKE_POLICY_VERSION,
      };
    }
  }
  // Fail-closed: virus scan must complete before accept.
  if (input.virusScanClean === null) {
    return {
      accepted: false,
      rejectionCode: 'virus_scan_pending',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  if (!input.virusScanClean) {
    return {
      accepted: false,
      rejectionCode: 'virus_detected',
      policyVersion: INTAKE_POLICY_VERSION,
    };
  }
  return { accepted: true, policyVersion: INTAKE_POLICY_VERSION };
}
