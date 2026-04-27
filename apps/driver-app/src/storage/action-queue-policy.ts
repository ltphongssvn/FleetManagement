// apps/driver-app/src/storage/action-queue-policy.ts
// Pure functions for local_action_log queue logic. No SQLite dep -
// fully unit-testable; storage adapter calls these.
import type { ActionId, AggregateId } from '@fleet/sync-protocol';

export type ActionStatus = 'pending' | 'syncing' | 'synced' | 'rejected' | 'superseded';

export interface QueueableAction {
  readonly actionId: ActionId;
  readonly aggregateType: string;
  readonly aggregateId: AggregateId;
  readonly status: ActionStatus;
  readonly sequence: number;
  /**
   * 1-level dependency only by PDF design:
   * "blocked_by_action_id for upload->sync only"
   * Upload actions are never blocked; sync actions reference upload's actionId.
   */
  readonly blockedByActionId: ActionId | null;
}

/** Returns the next sequence number for a given aggregate. FIFO per-aggregate. */
export function nextSequence(existing: readonly QueueableAction[], aggregateId: AggregateId): number {
  const max = existing
    .filter((a) => a.aggregateId === aggregateId)
    .reduce((acc, a) => Math.max(acc, a.sequence), 0);
  return max + 1;
}

/**
 * Returns actions safe to dispatch to /sync.
 * Filters: status='pending', blocker (if any) is synced.
 */
export function dispatchableActions(all: readonly QueueableAction[]): readonly QueueableAction[] {
  const syncedIds = new Set(all.filter((a) => a.status === 'synced').map((a) => a.actionId));
  const eligible = all
    .filter((a) => a.status === 'pending')
    .filter((a) => a.blockedByActionId === null || syncedIds.has(a.blockedByActionId));
  const copy: QueueableAction[] = [...eligible];
  copy.sort((a, b) => {
    if (a.aggregateId !== b.aggregateId) return a.aggregateId.localeCompare(b.aggregateId);
    return a.sequence - b.sequence;
  });
  return copy;
}

export function isSupersededByServer(
  serverResult: 'applied' | 'duplicate' | 'rejected' | 'superseded',
): boolean {
  return serverResult === 'superseded';
}
