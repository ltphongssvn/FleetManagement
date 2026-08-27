// packages/sync-protocol/src/sync-types.ts
// Wire types for POST /sync per Frozen Stack PDF p2-3.
// Single source of truth: types derived from as const arrays.
// Branded ids and the request contract now live in sync-contract.ts, where one
// Zod schema declares each and the type derives from it. This file keeps the
// RESPONSE shape, which the server constructs and no client parses.
import type { SyncCursor } from './sync-contract.js';

// ---------------------------------------------------------------------------
// Branded ID types — compile-time safety against ID mix-ups
// ---------------------------------------------------------------------------

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

export type SyncStatus = (typeof SYNC_STATUSES)[number];

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

export type SyncActionResult = (typeof SYNC_ACTION_RESULTS)[number];

// ---------------------------------------------------------------------------
// Request / Response interfaces
// ---------------------------------------------------------------------------

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
