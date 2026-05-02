// apps/api/src/sync/sync.service.ts
// Three append paths in same tx per PDF: fleet_audit_log + sync_change_feed + outbox.
// Idempotent on action_id (UNIQUE in sync_change_feed).
// Wire shape MUST match @fleet/sync-protocol SyncResponse — driver-app validates
// every field and will reject the response otherwise (see fetch-sync-transport.ts).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  createSyncCursor,
  type SyncResponse,
  type SyncActionResult,
  type SyncCursor,
} from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  fleetAuditLog,
  syncChangeFeed,
  outbox,
} from '../database/schema/index.js';
import type { SyncRequestInput, SyncActionInput } from './sync.dto.js';

import { mapDbErrorToSyncResult } from './error-mapping.js';
import { parseCursor } from './parse-cursor.js';

const DELTA_PULL_LIMIT = 500;

import type { OperatorContext } from '../auth/operator-context.js';
export type { OperatorContext };

/** Re-exported for legacy imports; new callers should use SyncResponse from @fleet/sync-protocol. */
export type SyncResponseOutput = SyncResponse;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /**
   * Process a sync request:
   * - For each action: insert into fleet_audit_log + sync_change_feed + outbox in one tx
   * - On unique violation (duplicate action_id): mark 'duplicate', do not throw
   * - Pull deltas after the client cursor up to DELTA_PULL_LIMIT
   * - Returns full SyncResponse per @fleet/sync-protocol contract
   */
  async processSync(req: SyncRequestInput, op: OperatorContext): Promise<SyncResponse> {
    const results: SyncActionResult[] = [];
    for (const action of req.actions) {
      const result = await this.applyAction(action, op);
      results.push(result);
    }

    // Pull deltas the client hasn't seen yet (PDF Day-One #4: delta sync only).
    const cursorBig = parseCursor(req.cursor);
    const deltaRows = await this.db
      .select({
        serverSeq: sql<string>`${syncChangeFeed.serverSeq}::text`,
        actionId: syncChangeFeed.actionId,
        aggregateType: syncChangeFeed.aggregateType,
        aggregateId: syncChangeFeed.aggregateId,
        delta: syncChangeFeed.delta,
        createdAt: syncChangeFeed.createdAt,
      })
      .from(syncChangeFeed)
      .where(and(eq(syncChangeFeed.companyId, op.companyId), gt(syncChangeFeed.serverSeq, cursorBig)))
      .orderBy(syncChangeFeed.serverSeq)
      .limit(DELTA_PULL_LIMIT);

    // newCursor advances to the highest server_seq the client now has visibility of.
    // If no deltas returned and no actions applied, keep the request cursor (no-op).
    const lastDeltaRow = deltaRows[deltaRows.length - 1];
    const lastDeltaSeq = lastDeltaRow ? BigInt(lastDeltaRow.serverSeq) : cursorBig;
    const newCursorStr = lastDeltaSeq.toString();
    const newCursor: SyncCursor = createSyncCursor(newCursorStr);

    const eventSeq = Number(newCursorStr);
    if (!Number.isSafeInteger(eventSeq) || eventSeq < 0) {
      // Defensive: server_seq exceeds Number.MAX_SAFE_INTEGER means we have
      // outgrown JS-number cursors — schema migration to string cursors required.
      throw new Error(`server_seq ${newCursorStr} exceeds safe integer range`);
    }

    return {
      status: 'ok',
      newCursor,
      eventSeq,
      deltas: deltaRows,
      results: results as readonly SyncActionResult[],
      serverTime: new Date().toISOString(),
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
  }

  private async applyAction(action: SyncActionInput, op: OperatorContext): Promise<SyncActionResult> {
    try {
      await this.db.transaction(async (tx) => {
        // Allocate next server_seq atomically. In production this becomes a sequence;
        // for pilot we use MAX+1 inside the tx (gap-tolerant per PDF).
        // server_seq from Postgres sequence fleet_server_seq (atomic, lock-free).
        // Replaces MAX()+1 race that produced duplicate seqs under concurrency.
        const seqRow = await tx.execute(
          sql<{ next_seq: string }>`SELECT nextval('fleet_server_seq')::text AS next_seq`,
        );
        const seqRows = (seqRow as unknown as { rows: readonly { next_seq: string }[] }).rows;
        const nextSeqStr = seqRows[0]?.next_seq;
        if (nextSeqStr === undefined) throw new Error('fleet_server_seq nextval returned no row');
        const nextSeq = BigInt(nextSeqStr);

        await tx.insert(syncChangeFeed).values({
          serverSeq: nextSeq,
          actionId: action.actionId,
          aggregateType: action.aggregateType,
          aggregateId: action.aggregateId,
          delta: action.payload,
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });

        await tx.insert(fleetAuditLog).values({
          serverSeq: nextSeq,
          operatorId: op.operatorId,
          eventType: `${action.aggregateType}.action_received`,
          aggregateType: action.aggregateType,
          aggregateId: action.aggregateId,
          payload: action.payload,
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });

        await tx.insert(outbox).values({
          queueName: 'projections',
          payload: { actionId: action.actionId, aggregateType: action.aggregateType, aggregateId: action.aggregateId, serverSeq: nextSeq.toString() },
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });
      });
      return 'applied';
    } catch (err) {
      const result = mapDbErrorToSyncResult(err);
      if (result === 'duplicate') {
        this.logger.debug(`Duplicate action_id: ${action.actionId}`);
      } else {
        this.logger.error(`Failed to apply action ${action.actionId}`, err);
      }
      return result;
    }
  }

  /** Fetch deltas after a given cursor for a tenant (used by client pull). */
  async deltasAfter(cursor: string, op: OperatorContext): Promise<readonly { serverSeq: string; actionId: string; aggregateType: string; aggregateId: string; delta: unknown }[]> {
    const cursorBig = parseCursor(cursor);
    const rows = await this.db
      .select({
        serverSeq: sql<string>`${syncChangeFeed.serverSeq}::text`,
        actionId: syncChangeFeed.actionId,
        aggregateType: syncChangeFeed.aggregateType,
        aggregateId: syncChangeFeed.aggregateId,
        delta: syncChangeFeed.delta,
      })
      .from(syncChangeFeed)
      .where(and(eq(syncChangeFeed.companyId, op.companyId), gt(syncChangeFeed.serverSeq, cursorBig)))
      .orderBy(syncChangeFeed.serverSeq)
      .limit(DELTA_PULL_LIMIT);
    return rows;
  }
}
