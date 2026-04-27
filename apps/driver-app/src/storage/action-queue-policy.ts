// apps/driver-app/src/storage/action-queue-policy.ts
// Pure functions for local_action_log queue logic. No SQLite dep -
// fully unit-testable; storage adapter calls these.

export type ActionStatus = 'pending' | 'syncing' | 'synced' | 'rejected' | 'superseded';

export interface QueueableAction {
  readonly actionId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly status: ActionStatus;
  readonly sequence: number;
  readonly blockedByActionId: string | null;
}

/** Returns the next sequence number for a given aggregate. FIFO per-aggregate. */
export function nextSequence(existing: readonly QueueableAction[], aggregateId: string): number {
  const max = existing
    .filter((a) => a.aggregateId === aggregateId)
    .reduce((acc, a) => Math.max(acc, a.sequence), 0);
  return max + 1;
}

/**
 * Returns actions safe to dispatch to /sync.
 * Filters: status='pending', not blocked by an unsynced action.
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

/**
 * Determines if a server-returned action_id supersedes a local action.
 * Per PDF: server result 'superseded' triggers local supersede.
 */
export function isSupersededByServer(
  serverResult: 'applied' | 'duplicate' | 'rejected' | 'superseded',
): boolean {
  return serverResult === 'superseded';
}
