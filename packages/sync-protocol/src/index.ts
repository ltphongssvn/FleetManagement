// packages/sync-protocol/src/index.ts
// Barrel export for @fleet/sync-protocol package.
// Named exports only — no `export *` to prevent namespace pollution.
export {
  type ActionId,
  type SyncCursor,
  type AggregateId,
  type ManifestCorrelationId,
  createActionId,
  createSyncCursor,
  createAggregateId,
  type SyncStatus,
  SYNC_STATUSES,
  type SyncActionResult,
  SYNC_ACTION_RESULTS,
  type SyncAction,
  type SyncRequest,
  type SyncResponse,
} from './sync-types.js';
