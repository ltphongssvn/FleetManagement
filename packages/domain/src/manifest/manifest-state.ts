// packages/domain/src/manifest/manifest-state.ts
// Manifest + upload_session state constants per Frozen Stack PDF "Manifest" + "Uploads".
// Single source of truth for state-array reuse in services (replaces inline arrays
// scattered across manifest.service.ts inArray() guards).
export const UPLOAD_SESSION_STATES = [
  'initiated', 'uploading', 'verifying', 'committed', 'rejected', 'aborted',
] as const;
export type UploadSessionState = typeof UPLOAD_SESSION_STATES[number];

/** States from which commitUpload() may transition to 'verifying'. */
export const UPLOAD_SESSION_COMMITTABLE_STATES = ['initiated', 'uploading'] as const;

/** States from which finalizeIntake() may transition to committed/rejected. */
export const UPLOAD_SESSION_FINALIZABLE_STATES = ['verifying'] as const;

export const MANIFEST_STATES = [
  'pending', 'verifying', 'captured', 'committed', 'rejected',
] as const;
export type ManifestState = typeof MANIFEST_STATES[number];

/** States from which manifest may transition to 'verifying'. Guards backsliding from terminal states. */
export const MANIFEST_VERIFIABLE_STATES = ['pending', 'verifying'] as const;

/** States from which manifest may transition to committed/rejected. */
export const MANIFEST_FINALIZABLE_STATES = ['verifying'] as const;
