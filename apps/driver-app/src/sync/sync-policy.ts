// apps/driver-app/src/sync/sync-policy.ts
// Pure functions for client-side sync orchestration. No fetch/network/SQLite
// deps - fully unit-testable. The storage adapter calls these to decide:
//   1) Which queued actions to bundle into the next POST /sync
//   2) How to reconcile a SyncResponse back into local_action_log status
//
// Frozen Stack PDF Day-One #4: 'POST /sync -> ok or cursor_expired' +
// 'client dedup > last_seen_seq'.
import type {
  SyncAction,
  SyncRequest,
  SyncResponse,
  SyncActionResult,
  SyncCursor,
} from '@fleet/sync-protocol';
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
  // Empty dispatchable → slice = [] → actions = [], dispatchedActionIds = []. No
  // special-case needed; the general code path handles it correctly.
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
  | {
      readonly kind: 'protocol_violation';
      readonly reason: 'results_length_mismatch';
      readonly expected: number;
      readonly actual: number;
    }
  | {
      readonly kind: 'ok';
      readonly newCursor: SyncCursor;
      readonly transitions: readonly ActionTransition[];
    };

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
  // After the L86 length-match check, dispatchedActionIds[i] and results[i] are
  // guaranteed defined for i in [0, length). Use a zip-style map instead of an
  // index loop to avoid defensive "continue" guards Stryker can\'t kill.
  // After the L86 length-match check, dispatchedActionIds.length === results.length.
  // Map over results directly so TS narrows result to SyncActionResult (defined),
  // and use response.results.map with the index to look up the paired actionId.
  // The `?? \'\'` fallback below is unreachable (lengths verified equal at L86)
  // but required by TS strict noUncheckedIndexedAccess. Stryker mutants on it
  // are equivalent.
  const transitions: ActionTransition[] = response.results.map((result, i) => {
    // Stryker disable next-line all: fallback unreachable after L86 length check
    const actionId = dispatchedActionIds[i] ?? '';
    return { actionId, newStatus: mapResultToStatus(result), result };
  });
  return { kind: 'ok', newCursor: response.newCursor, transitions };
}

/** Result -> ActionStatus mapping. Table form lets Stryker mutate single
 *  entries (each killable with per-entry assertions) instead of 5+ separate
 *  case-string mutants per status, avoiding the equivalent "rejected" -> ""
 *  fall-through mutant that survives because the default branch coincidentally
 *  returns the same string. Partial type lets us pass an unknown enum value
 *  through verbatim without an explicit cast. */
const RESULT_TO_STATUS: Readonly<Partial<Record<string, ActionStatus>>> = {
  applied: 'synced',
  duplicate: 'synced',
  rejected: 'rejected',
  superseded: 'superseded',
  awaiting_handoff: 'pending',
  awaiting_proof: 'pending',
  hint_conflict: 'pending',
};

function mapResultToStatus(result: SyncActionResult): ActionStatus {
  // For an unknown SyncActionResult (a future server-side enum value not yet
  // in this client), fall back to returning the value verbatim. The test
  // "unknown SyncActionResult triggers the never-exhaustiveness path"
  // relies on this pass-through.
  const mapped = RESULT_TO_STATUS[result];
  if (mapped !== undefined) return mapped;
  return result as unknown as ActionStatus;
}
