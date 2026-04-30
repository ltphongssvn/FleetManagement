// apps/driver-app/src/sync/sync-loop.ts
// Sync loop orchestrator: composes pure sync-policy with injectable transport
// and storage ports. Driver-app native code (Expo) wires real fetch + SQLite.
// Tests inject in-memory fakes.
//
// Frozen Stack PDF Day-One #4: 'POST /sync -> ok or cursor_expired' +
// 'client dedup > last_seen_seq'. PDF Day-One #6: 'Expo Push fallback for
// offline-to-online wake' (push triggers loop; loop itself is pull-based).
import type { SyncCursor, SyncRequest, SyncResponse } from '@fleet/sync-protocol';

export interface SyncCommit {
  readonly transitions: readonly ActionTransition[];
  readonly newCursor: SyncCursor;
  // PDF wire protocol: cursor must advance only when these are durably applied.
  readonly deltas: readonly unknown[];
  readonly projectionStatus: Record<string, unknown>;
  readonly hysteresisVersion: number;
  readonly configFlagVersion: number;
  readonly serverTime: string;
}
import {
  planSyncRequest,
  reconcileSyncAck,
  type AckOutcome,
  type QueuedActionWithPayload,
  type ActionTransition,
} from './sync-policy.js';

export interface SyncTransport {
  /** POST /sync. Throws on network/HTTP errors. */
  post(req: SyncRequest): Promise<SyncResponse>;
}

export interface SyncStateStore {
  readDispatchable(): Promise<readonly QueuedActionWithPayload[]>;
  readCursor(): Promise<SyncCursor>;
  /** Mark batch as 'syncing' before /sync POST. Prevents concurrent loop
   *  from re-dispatching the same actions while transport is in flight. */
  claimDispatched(actionIds: readonly string[]): Promise<void>;
  /** Atomic commit: persist transitions + deltas + cursor in one DB tx so the
   *  client cursor never advances ahead of applied server work. PDF requirement. */
  applySyncCommit(commit: SyncCommit): Promise<void>;
  /** Roll dispatched actions back to 'pending' status. Used on transport
   *  failure or protocol_violation so they retry on the next loop. */
  rollbackDispatched(actionIds: readonly string[]): Promise<void>;
  /** Wipe local cursor + reset 'syncing' actions to 'pending' so caller can
   *  bootstrap. The store knows what is 'syncing'; orchestrator does not
   *  micromanage which IDs to reset. */
  resetForCursorExpired(): Promise<void>;
}

export type SyncLoopOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'applied'; readonly newCursor: SyncCursor; readonly transitions: readonly ActionTransition[] }
  | { readonly kind: 'cursor_expired_recovered' }
  | { readonly kind: 'protocol_violation'; readonly expected: number; readonly actual: number }
  | { readonly kind: 'transport_failure'; readonly error: Error; readonly rolledBackCount: number }
  | { readonly kind: 'storage_failure'; readonly error: Error; readonly stage: 'apply_ack' | 'rollback' | 'reset' };

async function rollbackIfDispatched(
  store: SyncStateStore,
  dispatchedActionIds: readonly string[],
): Promise<{ rolledBackCount: number; storageError?: Error }> {
  if (dispatchedActionIds.length === 0) {
    return { rolledBackCount: 0 };
  }
  try {
    await store.rollbackDispatched(dispatchedActionIds);
    return { rolledBackCount: dispatchedActionIds.length };
  } catch (err: unknown) {
    return {
      rolledBackCount: 0,
      storageError: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Run one sync iteration. Caller (UI/timer/push handler) invokes repeatedly.
 * Pure orchestration: all I/O via injected ports.
 */
export async function runSyncOnce(
  transport: SyncTransport,
  store: SyncStateStore,
): Promise<SyncLoopOutcome> {
  const [dispatchable, cursor] = await Promise.all([
    store.readDispatchable(),
    store.readCursor(),
  ]);
  const plan = planSyncRequest(dispatchable, cursor);

  // #718: claim before transport so a concurrent runSyncOnce sees these as
  // 'syncing' and skips them in dispatchableActions().
  if (plan.dispatchedActionIds.length > 0) {
    try {
      await store.claimDispatched(plan.dispatchedActionIds);
    } catch (err: unknown) {
      return {
        kind: 'storage_failure',
        error: err instanceof Error ? err : new Error(String(err)),
        stage: 'apply_ack',
      };
    }
  }

  let response: SyncResponse;
  try {
    response = await transport.post(plan.request);
  } catch (err: unknown) {
    const transportError = err instanceof Error ? err : new Error(String(err));
    const rb = await rollbackIfDispatched(store, plan.dispatchedActionIds);
    if (rb.storageError) {
      return { kind: 'storage_failure', error: rb.storageError, stage: 'rollback' };
    }
    return { kind: 'transport_failure', error: transportError, rolledBackCount: rb.rolledBackCount };
  }

  const outcome: AckOutcome = reconcileSyncAck(plan.dispatchedActionIds, response);

  if (outcome.kind === 'cursor_expired') {
    try {
      await store.resetForCursorExpired();
    } catch (err: unknown) {
      return {
        kind: 'storage_failure',
        error: err instanceof Error ? err : new Error(String(err)),
        stage: 'reset',
      };
    }
    return { kind: 'cursor_expired_recovered' };
  }

  if (outcome.kind === 'protocol_violation') {
    const rb = await rollbackIfDispatched(store, plan.dispatchedActionIds);
    if (rb.storageError) {
      return { kind: 'storage_failure', error: rb.storageError, stage: 'rollback' };
    }
    return { kind: 'protocol_violation', expected: outcome.expected, actual: outcome.actual };
  }

  try {
    await store.applySyncCommit({
      transitions: outcome.transitions,
      newCursor: outcome.newCursor,
      deltas: response.deltas,
      projectionStatus: response.projectionStatus,
      hysteresisVersion: response.hysteresisVersion,
      configFlagVersion: response.configFlagVersion,
      serverTime: response.serverTime,
    });
  } catch (err: unknown) {
    return {
      kind: 'storage_failure',
      error: err instanceof Error ? err : new Error(String(err)),
      stage: 'apply_ack',
    };
  }

  const hasLocalAcks = outcome.transitions.length > 0;
  const hasRemoteWork = response.deltas.length > 0;
  if (!hasLocalAcks && !hasRemoteWork && plan.dispatchedActionIds.length === 0) {
    return { kind: 'idle' };
  }
  return { kind: 'applied', newCursor: outcome.newCursor, transitions: outcome.transitions };
}
