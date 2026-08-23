// apps/driver-app/src/storage/action-queue-policy.ts
// Pure functions for local_action_log queue logic. No SQLite dep -
// fully unit-testable; storage adapter calls these.
import type { ActionId, AggregateId, SyncActionResult } from '@fleet/sync-protocol';

export type ActionStatus = 'pending' | 'syncing' | 'synced' | 'rejected' | 'superseded';

export interface QueueableAction {
  readonly actionId: ActionId;
  readonly aggregateType: string;
  readonly aggregateId: AggregateId;
  readonly status: ActionStatus;
  readonly sequence: number;
  /** 1-level dependency only by PDF design. See ADR-003. */
  readonly blockedByActionId: ActionId | null;
}

/** Returns the next sequence number for a given aggregate. FIFO per-aggregate. */
export function nextSequence(
  existing: readonly QueueableAction[],
  aggregateId: AggregateId,
): number {
  const max = existing
    .filter((a) => a.aggregateId === aggregateId)
    .reduce((acc, a) => Math.max(acc, a.sequence), 0);
  return max + 1;
}

/**
 * Returns actions safe to dispatch to /sync.
 * Filters: status='pending', blocker (if any) is synced.
 * FIFO guarantee: only the lowest-sequence pending action per aggregate is dispatched
 * (head-of-line). Prevents the worker from sending two pending actions for the same
 * aggregate concurrently and breaking ordering on the server.
 */
export function dispatchableActions(all: readonly QueueableAction[]): readonly QueueableAction[] {
  const syncedIds = new Set(all.filter((a) => a.status === 'synced').map((a) => a.actionId));
  const eligible = all
    .filter((a) => a.status === 'pending')
    .filter((a) => a.blockedByActionId === null || syncedIds.has(a.blockedByActionId));

  // Head-of-line per aggregate: keep only the lowest sequence per aggregateId.
  const headByAggregate = new Map<AggregateId, QueueableAction>();
  for (const a of eligible) {
    const current = headByAggregate.get(a.aggregateId);
    if (!current || a.sequence < current.sequence) {
      headByAggregate.set(a.aggregateId, a);
    }
  }

  const heads: QueueableAction[] = [...headByAggregate.values()];
  heads.sort((a, b) => a.aggregateId.localeCompare(b.aggregateId));
  return heads;
}

/** Reuses SyncActionResult from sync-protocol (single source of truth). */
export function isSupersededByServer(serverResult: SyncActionResult): boolean {
  return serverResult === 'superseded';
}
