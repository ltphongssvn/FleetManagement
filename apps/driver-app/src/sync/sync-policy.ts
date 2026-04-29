// apps/driver-app/src/sync/sync-policy.ts
// Pure functions for client-side sync orchestration. No fetch/network/SQLite
// deps - fully unit-testable. The storage adapter calls these to decide:
//   1) Which queued actions to bundle into the next POST /sync
//   2) How to reconcile a SyncResponse back into local_action_log status
//
// Frozen Stack PDF Day-One #4: 'POST /sync -> ok or cursor_expired' +
// 'client dedup > last_seen_seq'.
import type { SyncAction, SyncRequest, SyncResponse, SyncActionResult, SyncCursor } from '@fleet/sync-protocol';
import type { QueueableAction, ActionStatus } from '../storage/action-queue-policy.js';

export const SYNC_POLICY_VERSION = 'sync-loop-v1' as const;

/** Default max actions per /sync POST. PDF Day-One pilot scope: 5 trucks/depot. */
export const DEFAULT_SYNC_BATCH_SIZE = 50 as const;

export interface QueuedActionWithPayload extends QueueableAction {
  readonly payload: unknown;
}

export interface SyncRequestPlan {
  readonly request: SyncRequest;
  readonly dispatchedActionIds: readonly string[];
}

/**
 * Build the next /sync request from dispatchable actions + current cursor.
 * Empty actions array signals a heartbeat sync (cursor advance only).
 *
 * Ordering contract: caller MUST pass dispatchable in FIFO order. The storage
 * layer's dispatchableActions() (action-queue-policy.ts) enforces this; this
 * function does not re-sort. Out-of-order input -> out-of-order /sync POST.
 */
export function planSyncRequest(
  dispatchable: readonly QueuedActionWithPayload[],
  cursor: SyncCursor,
  batchSize: number = DEFAULT_SYNC_BATCH_SIZE,
): SyncRequestPlan {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`batchSize must be a positive safe integer, got ${String(batchSize)}`);
  }
  if (dispatchable.length === 0) {
    return { request: { cursor, actions: [] }, dispatchedActionIds: [] };
  }
  const slice = dispatchable.slice(0, batchSize);
  const nowIso = new Date().toISOString();
  const actions: SyncAction[] = slice.map((a) => ({
    actionId: a.actionId,
    aggregateType: a.aggregateType,
    aggregateId: a.aggregateId,
    payload: a.payload,
    timestamp: nowIso,
  }));
  return { request: { cursor, actions }, dispatchedActionIds: slice.map((a) => a.actionId) };
}

export type AckOutcome =
  | { readonly kind: 'cursor_expired' }
  | { readonly kind: 'protocol_violation'; readonly reason: 'results_length_mismatch'; readonly expected: number; readonly actual: number }
  | { readonly kind: 'ok'; readonly newCursor: SyncCursor; readonly transitions: readonly ActionTransition[] };

export interface ActionTransition {
  readonly actionId: string;
  readonly newStatus: ActionStatus;
  readonly result: SyncActionResult;
}

/**
 * Reconcile a SyncResponse back into local action statuses.
 * Pairs each result positionally with the action it was sent for.
 */
export function reconcileSyncAck(
  dispatchedActionIds: readonly string[],
  response: SyncResponse,
): AckOutcome {
  if (response.status === 'cursor_expired') {
    return { kind: 'cursor_expired' };
  }
  if (response.status !== 'ok') {
    return { kind: 'ok', newCursor: response.newCursor, transitions: [] };
  }
  // PDF wire protocol: results array is positional with the request's actions array.
  // A length mismatch is a server protocol violation - the client MUST NOT silently
  // drop unmatched actions (they would stay 'syncing' forever). Caller rolls the
  // entire batch back to 'pending' for retry on next loop.
  if (dispatchedActionIds.length !== response.results.length) {
    return {
      kind: 'protocol_violation',
      reason: 'results_length_mismatch',
      expected: dispatchedActionIds.length,
      actual: response.results.length,
    };
  }
  const transitions: ActionTransition[] = [];
  for (let i = 0; i < dispatchedActionIds.length; i++) {
    const actionId = dispatchedActionIds[i];
    const result = response.results[i];
    if (actionId === undefined || result === undefined) continue;
    transitions.push({ actionId, newStatus: mapResultToStatus(result), result });
  }
  return { kind: 'ok', newCursor: response.newCursor, transitions };
}

function mapResultToStatus(result: SyncActionResult): ActionStatus {
  switch (result) {
    case 'applied':
    case 'duplicate':
      return 'synced';
    case 'rejected':
      return 'rejected';
    case 'superseded':
      return 'superseded';
    case 'awaiting_handoff':
    case 'awaiting_proof':
    case 'hint_conflict':
      return 'pending';
    default: {
      // Compile-time exhaustiveness: future SyncActionResult values must be
      // explicitly mapped above. If TS errors here, add the missing case.
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
