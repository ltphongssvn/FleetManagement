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
