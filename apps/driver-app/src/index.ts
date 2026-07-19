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
export {
  DRIVER_ALERT_NAV_POLICY_VERSION,
  decideDriverAlertNavigation,
  type DriverAlertNavDecision,
} from './push/driver-alert-navigation-policy.js';
export {
  buildTransportAlertChannelConfig,
  runNotificationSetup,
  type ChannelAudioUsage,
  type ChannelImportance,
  type NotificationPlatformPort,
  type NotificationSetupResult,
  type PermissionStatus,
  type TransportAlertChannelConfig,
} from './push/notification-setup-policy.js';
export {
  PUSH_REGISTRATION_POLICY_VERSION,
  PUSH_TOKEN_TTL_MS,
  isValidExpoPushToken,
  decidePushRegistration,
  type PushTokenInput,
  type RegisteredPushToken,
  type PushRegistrationDecision,
  type PushTokenRejectionCode,
} from './push/push-registration-policy.js';
export {
  SYNC_SCHEDULER_POLICY_VERSION,
  SYNC_IDLE_INTERVAL_MS,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  SYNC_BACKOFF_JITTER_RATIO,
  SYNC_CIRCUIT_BREAKER_THRESHOLD,
  decideSyncSchedule,
  type SyncTrigger,
  type SyncSchedulerOutcome,
  type SyncSchedulerState,
  type SyncSchedulerDecision,
  type SyncSchedulerDeps,
} from './sync/sync-scheduler-policy.js';
export {
  SYNC_STATUS_PRESENTER_VERSION,
  SYNC_RECENT_THRESHOLD_MS,
  presentSyncStatus,
  type SyncStatusKind,
  type SyncStatusView,
} from './sync/sync-status-presenter.js';
