// apps/api/src/sync/sync.service.ts
// Three append paths in same tx per PDF: fleet_audit_log + sync_change_feed + outbox.
// Idempotent on action_id (UNIQUE in sync_change_feed).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  fleetAuditLog,
  syncChangeFeed,
  outbox,
} from '../database/schema/index.js';
import type { SyncRequestInput, SyncActionInput } from './sync.dto.js';

const PG_UNIQUE_VIOLATION = '23505';

interface PgError {
  code?: string;
}

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5; i++) {
    if (typeof cur !== 'object' || cur === null) return false;
    if ((cur as PgError).code === PG_UNIQUE_VIOLATION) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export type SyncActionResult = 'applied' | 'duplicate' | 'rejected';

export interface SyncResponseOutput {
  readonly status: 'ok';
  readonly newCursor: string;
  readonly eventSeq: number;
  readonly results: readonly SyncActionResult[];
  readonly serverTime: string;
}

import type { OperatorContext } from '../auth/operator-context.js';
export type { OperatorContext };

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /**
   * Process a sync request:
   * - For each action: insert into fleet_audit_log + sync_change_feed + outbox in one tx
   * - On unique violation (duplicate action_id): mark 'duplicate', do not throw
   * - Returns deltas since cursor + new cursor (max server_seq)
   */
  async processSync(req: SyncRequestInput, op: OperatorContext): Promise<SyncResponseOutput> {
    const results: SyncActionResult[] = [];
    for (const action of req.actions) {
      const result = await this.applyAction(action, op);
      results.push(result);
    }

    // Compute new cursor from max server_seq seen so far for this tenant.
    const cursorRow = await this.db
      .select({ maxSeq: sql<string>`COALESCE(MAX(${syncChangeFeed.serverSeq}), 0)::text` })
      .from(syncChangeFeed)
      .where(eq(syncChangeFeed.companyId, op.companyId));
    const newCursor = cursorRow[0]?.maxSeq ?? '0';

    return {
      status: 'ok',
      newCursor,
      eventSeq: Number(newCursor),
      results,
      serverTime: new Date().toISOString(),
    };
  }

  private async applyAction(action: SyncActionInput, op: OperatorContext): Promise<SyncActionResult> {
    try {
      await this.db.transaction(async (tx) => {
        // Allocate next server_seq atomically. In production this becomes a sequence;
        // for pilot we use MAX+1 inside the tx (gap-tolerant per PDF).
        const seqRow = await tx
          .select({ maxSeq: sql<string>`COALESCE(MAX(${syncChangeFeed.serverSeq}), 0)::text` })
          .from(syncChangeFeed)
          .where(eq(syncChangeFeed.companyId, op.companyId));
        const nextSeq = BigInt(seqRow[0]?.maxSeq ?? '0') + 1n;

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
      if (isPgUniqueViolation(err)) {
        this.logger.debug(`Duplicate action_id: ${action.actionId}`);
        return 'duplicate';
      }
      this.logger.error(`Failed to apply action ${action.actionId}`, err);
      return 'rejected';
    }
  }

  /** Fetch deltas after a given cursor for a tenant (used by client pull). */
  async deltasAfter(cursor: string, op: OperatorContext): Promise<readonly { serverSeq: string; actionId: string; aggregateType: string; aggregateId: string; delta: unknown }[]> {
    const cursorBig = BigInt(cursor);
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
      .limit(500);
    return rows;
  }
}
