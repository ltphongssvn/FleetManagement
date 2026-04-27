// packages/sync-protocol/src/sync-types.ts
// Wire types for POST /sync per Frozen Stack PDF p2-3.
// Single source of truth: types derived from as const arrays.
// Branded types prevent cross-contamination of IDs.

// ---------------------------------------------------------------------------
// Branded ID types — compile-time safety against ID mix-ups
// ---------------------------------------------------------------------------

/** Branded type for client-generated action IDs (UUIDv7 per PDF). */
export type ActionId = string & { readonly __brand: unique symbol };

/** Branded type for sync cursor (opaque server-issued token). */
export type SyncCursor = string & { readonly __brand: unique symbol };

/** Branded type for aggregate IDs. */
export type AggregateId = string & { readonly __brand: unique symbol };

/** Branded type for manifest correlation IDs (UUIDv7 per PDF). */
export type ManifestCorrelationId = string & { readonly __brand: unique symbol };

/** Factory: create ActionId from raw string (validated at boundary). */
export function createActionId(raw: string): ActionId {
  return raw as ActionId;
}

/** Factory: create SyncCursor from raw string. */
export function createSyncCursor(raw: string): SyncCursor {
  return raw as SyncCursor;
}

/** Factory: create AggregateId from raw string. */
export function createAggregateId(raw: string): AggregateId {
  return raw as AggregateId;
}

// ---------------------------------------------------------------------------
// Sync status — single source of truth (type derived from array)
// ---------------------------------------------------------------------------

/** All possible sync response statuses per PDF. */
export const SYNC_STATUSES = [
  'ok',
  'cursor_expired',
  'config_refresh_required',
  'artifact_generation_in_progress',
  'artifact_unavailable',
  'lock_contended',
  'bootstrap_config_stale',
  'bootstrap_format_deprecated',
] as const;

export type SyncStatus = typeof SYNC_STATUSES[number];

// ---------------------------------------------------------------------------
// Action result — single source of truth
// ---------------------------------------------------------------------------

export const SYNC_ACTION_RESULTS = [
  'applied',
  'duplicate',
  'rejected',
  'superseded',
  'awaiting_handoff',
  'awaiting_proof',
  'hint_conflict',
] as const;

export type SyncActionResult = typeof SYNC_ACTION_RESULTS[number];

// ---------------------------------------------------------------------------
// Request / Response interfaces
// ---------------------------------------------------------------------------

/** A single client action sent to the server. */
export interface SyncAction {
  readonly actionId: ActionId;
  readonly aggregateType: string;
  readonly aggregateId: AggregateId;
  readonly payload: unknown;
  readonly timestamp: string;
}

/** Minimal sync request shape. Client sends cursor + actions. */
export interface SyncRequest {
  readonly cursor: SyncCursor;
  readonly actions: readonly SyncAction[];
}

/** Sync response from POST /sync per PDF wire protocol. */
export interface SyncResponse {
  readonly status: SyncStatus;
  readonly newCursor: SyncCursor;
  readonly eventSeq: number;
  readonly deltas: readonly unknown[];
  readonly results: readonly SyncActionResult[];
  readonly serverTime: string;
  readonly projectionStatus: Record<string, unknown>;
  readonly hysteresisVersion: number;
  readonly configFlagVersion: number;
  readonly retryAfterMs?: number;
}
