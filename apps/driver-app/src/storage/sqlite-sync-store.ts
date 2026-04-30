// apps/driver-app/src/storage/sqlite-sync-store.ts
// Native SyncStateStore adapter wrapping expo-sqlite via drizzle. Implements
// the port from sync-loop.ts so runSyncOnce can drive real local persistence.
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { eq, inArray, asc } from 'drizzle-orm';
import type * as SQLite from 'expo-sqlite';
import { createSyncCursor, type SyncCursor, type ActionId } from '@fleet/sync-protocol';
import type { SyncStateStore, SyncCommit } from '../sync/sync-loop.js';
import type { QueuedActionWithPayload } from '../sync/sync-policy.js';
import { dispatchableActions } from './action-queue-policy.js';
import { localActionLog, syncCursor } from './schema.js';

type Db = ExpoSQLiteDatabase<{ localActionLog: typeof localActionLog; syncCursor: typeof syncCursor }>;

export class SqliteSyncStore implements SyncStateStore {
  private readonly db: Db;
  constructor(sqlite: SQLite.SQLiteDatabase) {
    this.db = drizzle(sqlite, { schema: { localActionLog, syncCursor }, casing: 'snake_case' });
  }

  async readDispatchable(): Promise<readonly QueuedActionWithPayload[]> {
    const rows = await this.db.select().from(localActionLog).orderBy(asc(localActionLog.sequence));
    const queueable = rows.map((r): QueuedActionWithPayload => ({
      actionId: r.actionId,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      status: r.status,
      sequence: r.sequence,
      blockedByActionId: r.blockedByActionId,
      payload: r.payload,
    }));
    return dispatchableActions(queueable) as readonly QueuedActionWithPayload[];
  }

  async readCursor(): Promise<SyncCursor> {
    const rows = await this.db.select().from(syncCursor).where(eq(syncCursor.id, 1)).limit(1);
    return createSyncCursor(rows[0]?.cursor ?? '0');
  }

  async applySyncCommit(commit: SyncCommit): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      // Apply per-action transitions concurrently inside the same tx (#710).
      await Promise.all(commit.transitions.map((t) =>
        tx.update(localActionLog)
          .set({ status: t.newStatus, syncedAt: t.newStatus === 'synced' ? now : null })
          .where(eq(localActionLog.actionId, t.actionId as ActionId)),
      ));
      // Upsert cursor via ON CONFLICT (drizzle expo-sqlite supports onConflictDoUpdate).
      await tx.insert(syncCursor)
        .values({ id: 1, cursor: commit.newCursor, lastSeenSeq: 0, updatedAt: now })
        .onConflictDoUpdate({
          target: syncCursor.id,
          set: { cursor: commit.newCursor, updatedAt: now },
        });
      // Server deltas (commit.deltas) are read-model events; pilot scope: applied
      // by the worker's projection-runner server-side. Driver-app stores them
      // for offline display in a future slice (PDF Day-One: dispatch board is
      // ops-web only). For now we just ensure cursor advances atomically.
    });
  }

  async rollbackDispatched(actionIds: readonly string[]): Promise<void> {
    if (actionIds.length === 0) return;
    await this.db.update(localActionLog)
      .set({ status: 'pending' })
      .where(inArray(localActionLog.actionId, actionIds as ActionId[]));
  }

  async resetForCursorExpired(): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(localActionLog).set({ status: 'pending' }).where(eq(localActionLog.status, 'syncing'));
      // Upsert: if no cursor row exists yet (fresh app), insert; else reset.
      await tx.insert(syncCursor)
        .values({ id: 1, cursor: '0', lastSeenSeq: 0, updatedAt: now })
        .onConflictDoUpdate({
          target: syncCursor.id,
          set: { cursor: '0', lastSeenSeq: 0, updatedAt: now },
        });
    });
  }

  /** Mark batch of pending actions as 'syncing' before sending. Caller must
   *  call rollbackDispatched on transport failure. */
  async claimDispatched(actionIds: readonly string[]): Promise<void> {
    if (actionIds.length === 0) return;
    await this.db.update(localActionLog)
      .set({ status: 'syncing' })
      .where(inArray(localActionLog.actionId, actionIds as ActionId[]));
  }
}
