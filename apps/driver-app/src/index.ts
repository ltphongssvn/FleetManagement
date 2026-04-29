// apps/driver-app/src/index.ts
// Barrel export for @fleet/driver-app pure logic.
export { APP_VERSION } from './constants.js';
export {
  type ActionStatus,
  type QueueableAction,
  nextSequence,
  dispatchableActions,
  isSupersededByServer,
} from './storage/action-queue-policy.js';
export {
  runSyncOnce,
  type SyncTransport,
  type SyncStateStore,
  type SyncLoopOutcome,
} from './sync/sync-loop.js';
export {
  MANIFEST_CAPTURE_POLICY_VERSION,
  MANIFEST_MAX_FILE_BYTES,
  MANIFEST_MIN_FILE_BYTES,
  SIGNATURE_MIN_PATH_POINTS,
  SIGNATURE_MAX_PATH_POINTS,
  SIGNATURE_MAX_PATH_CHARS,
  validateCapturedFile,
  validateSignaturePath,
  type CapturedFile,
  type CapturedFileDecision,
  type SignaturePath,
  type SignatureDecision,
  type ManifestRejectionCode,
} from './manifest/manifest-capture-policy.js';
export {
  CAPTURE_SPOOL_POLICY_VERSION,
  SPOOL_ENTRY_TTL_MS,
  SPOOL_ENTRY_MIN_AGE_MS,
  SPOOL_MAX_ATTEMPTS,
  createSpoolEntry,
  classifyForRecovery,
  sweepSpool,
  type SpoolEntry,
  type SpoolEntryStatus,
  type NewSpoolEntryInput,
  type SweepClassification,
  type SweepDecision,
} from './manifest/capture-spool-policy.js';
