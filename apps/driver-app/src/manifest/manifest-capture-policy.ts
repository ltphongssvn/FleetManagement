// apps/driver-app/src/manifest/manifest-capture-policy.ts
// Pure validation for manifest captures (photos + signatures) before they hit
// the upload pipeline. No native deps - native code (expo-camera, expo-document-picker,
// signature canvas) calls these to validate before writing to capture_spool/.
//
// Frozen Stack PDF Day-One #5: 'expo-camera + expo-document-picker + signature
// SVG + S3 upload session'. Server-side intake-policy validates again at the
// API boundary (apps/api/src/manifest); this is the FAST CLIENT-SIDE GATE so
// drivers see immediate feedback instead of round-tripping a doomed upload.
import { ALLOWED_MANIFEST_MIME_TYPES, type ManifestMimeType } from '@fleet/sync-protocol';

// SVG path 'd' validates the FULL string (not just prefix). Allows the subset our
// signature canvas emits: M then space+digit, followed by L/M segments with
// numeric pairs (decimals, signs, commas-or-spaces). Rejects 'M10 10 banana'.
const SVG_PATH_RE = /^M\s*-?\d[\d.\s,\-+MLml]*$/;

export const MANIFEST_CAPTURE_POLICY_VERSION = 'manifest-capture-v1' as const;

/** Pilot ceiling: photos compressed by camera; PDFs are usually small. */
export const MANIFEST_MAX_FILE_BYTES = 26_214_400 as const;
export const MANIFEST_MIN_FILE_BYTES = 100 as const;
export const SIGNATURE_MIN_PATH_POINTS = 5 as const;
export const SIGNATURE_MAX_PATH_POINTS = 10_000 as const;
/** Path string DoS guard: low pointCount + huge `d` string would otherwise pass. */
export const SIGNATURE_MAX_PATH_CHARS = 100_000 as const;

export type ManifestRejectionCode =
  | 'invalid_mime'
  | 'too_small'
  | 'too_large'
  | 'invalid_size'
  | 'signature_empty'
  | 'signature_too_long'
  | 'signature_invalid';

export interface CapturedFile {
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export type CapturedFileDecision =
  | {
      readonly accepted: true;
      readonly mimeType: ManifestMimeType;
      readonly policyVersion: typeof MANIFEST_CAPTURE_POLICY_VERSION;
    }
  | {
      readonly accepted: false;
      readonly rejectionCode: ManifestRejectionCode;
      readonly policyVersion: typeof MANIFEST_CAPTURE_POLICY_VERSION;
    };

const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_MANIFEST_MIME_TYPES);

function rejectFile(code: ManifestRejectionCode): CapturedFileDecision {
  return { accepted: false, rejectionCode: code, policyVersion: MANIFEST_CAPTURE_POLICY_VERSION };
}

function rejectSignature(code: ManifestRejectionCode): SignatureDecision {
  return { accepted: false, rejectionCode: code, policyVersion: MANIFEST_CAPTURE_POLICY_VERSION };
}

/** Validate a captured photo / PDF before writing to capture_spool/. */
export function validateCapturedFile(file: CapturedFile): CapturedFileDecision {
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
    return rejectFile('invalid_size');
  }
  if (!ALLOWED_MIME_SET.has(file.mimeType)) {
    return rejectFile('invalid_mime');
  }
  if (file.sizeBytes < MANIFEST_MIN_FILE_BYTES) {
    return rejectFile('too_small');
  }
  if (file.sizeBytes > MANIFEST_MAX_FILE_BYTES) {
    return rejectFile('too_large');
  }
  return {
    accepted: true,
    mimeType: file.mimeType as ManifestMimeType,
    policyVersion: MANIFEST_CAPTURE_POLICY_VERSION,
  };
}

export interface SignaturePath {
  /** SVG path 'd' attribute. PDF: 'signature canvas (SVG path + PNG in S3)'. */
  readonly d: string;
  /** Distinct (x,y) points captured. Used for liveness sanity check. */
  readonly pointCount: number;
}

export type SignatureDecision =
  | {
      readonly accepted: true;
      readonly normalizedD: string;
      readonly policyVersion: typeof MANIFEST_CAPTURE_POLICY_VERSION;
    }
  | {
      readonly accepted: false;
      readonly rejectionCode: ManifestRejectionCode;
      readonly policyVersion: typeof MANIFEST_CAPTURE_POLICY_VERSION;
    };

/** Validate a signature SVG path. Pilot: lightweight liveness via point count. */
export function validateSignaturePath(sig: SignaturePath): SignatureDecision {
  if (!Number.isSafeInteger(sig.pointCount) || sig.pointCount < 0) {
    return rejectSignature('signature_invalid');
  }
  const trimmed = sig.d.trim();
  if (trimmed.length === 0 || sig.pointCount < SIGNATURE_MIN_PATH_POINTS) {
    return rejectSignature('signature_empty');
  }
  if (sig.pointCount > SIGNATURE_MAX_PATH_POINTS || trimmed.length > SIGNATURE_MAX_PATH_CHARS) {
    return rejectSignature('signature_too_long');
  }
  if (!SVG_PATH_RE.test(trimmed)) {
    return rejectSignature('signature_invalid');
  }
  return { accepted: true, normalizedD: trimmed, policyVersion: MANIFEST_CAPTURE_POLICY_VERSION };
}
