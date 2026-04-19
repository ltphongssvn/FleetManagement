// packages/sync-protocol/src/sync-types.ts
// Wire types for POST /sync per Frozen Stack PDF p2-3:
//   POST /sync → { status, newCursor, eventSeq, deltas[], results[],
//   serverTime, projectionStatus, hysteresisVersion,
//   configFlagVersion, retryAfterMs? }

/**
 * All possible sync response statuses per PDF.
 */
export type SyncStatus =
  | 'ok'
  | 'cursor_expired'
  | 'config_refresh_required'
  | 'artifact_generation_in_progress'
  | 'artifact_unavailable'
  | 'lock_contended'
  | 'bootstrap_config_stale'
  | 'bootstrap_format_deprecated';

/** Readonly tuple of all valid statuses for runtime validation. */
export const SYNC_STATUSES: readonly SyncStatus[] = [
  'ok',
  'cursor_expired',
  'config_refresh_required',
  'artifact_generation_in_progress',
  'artifact_unavailable',
  'lock_contended',
  'bootstrap_config_stale',
  'bootstrap_format_deprecated',
] as const;

/**
 * Action result statuses returned per-action in sync response.
 */
export type SyncActionResult =
  | 'applied'
  | 'duplicate'
  | 'rejected'
  | 'superseded'
  | 'awaiting_handoff'
  | 'awaiting_proof'
  | 'hint_conflict';

/**
 * Minimal sync request shape. Client sends cursor + actions.
 * Full schema will be refined when API module lands (Week 3).
 */
export interface SyncRequest {
  readonly cursor: string;
  readonly actions: readonly SyncAction[];
}

/** A single client action sent to the server. */
export interface SyncAction {
  readonly actionId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly timestamp: string;
}

/**
 * Sync response from POST /sync per PDF wire protocol.
 */
export interface SyncResponse {
  readonly status: SyncStatus;
  readonly newCursor: string;
  readonly eventSeq: number;
  readonly deltas: readonly unknown[];
  readonly results: readonly SyncActionResult[];
  readonly serverTime: string;
  readonly projectionStatus: Record<string, unknown>;
  readonly hysteresisVersion: number;
  readonly configFlagVersion: number;
  readonly retryAfterMs?: number;
}
