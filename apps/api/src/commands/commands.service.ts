// apps/api/src/commands/commands.service.ts
// Persists a command via the 3 append paths (sync_change_feed + fleet_audit_log
// + outbox) in a single transaction. Idempotent on action_id (replay-safe).
//
// Extracted from CommandsController to keep the controller as a thin HTTP
// layer. Mirrors the service-owns-DB idiom used by manifest.service.ts and
// sync.service.ts.
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { fleetAuditLog, syncChangeFeed, outbox } from '../database/schema/index.js';
import type { CommandPayload } from './command.dto.js';
import type { OperatorContext } from '../auth/operator-context.js';

export interface PersistResult {
  /** True when action_id already existed (replay). Audit/outbox skipped. */
  readonly duplicate: boolean;
}

@Injectable()
export class CommandsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async persist(cmd: CommandPayload, op: OperatorContext): Promise<PersistResult> {
    return this.db.transaction(async (tx) => {
      const seqRow = await tx.execute(
        sql<{ next_seq: string }>`SELECT nextval('fleet_server_seq')::text AS next_seq`,
      );
      const rows = (seqRow as unknown as { rows: readonly { next_seq: string }[] }).rows;
      const nextSeqStr = rows[0]?.next_seq;
      if (nextSeqStr === undefined) throw new Error('fleet_server_seq nextval returned no row');
      const nextSeq = BigInt(nextSeqStr);

      const inserted = await tx.insert(syncChangeFeed).values({
        serverSeq: nextSeq,
        actionId: cmd.commandId,
        aggregateType: cmd.aggregateType,
        aggregateId: cmd.aggregateId,
        delta: { type: cmd.type, payload: cmd.payload, targetOperatorId: cmd.targetOperatorId },
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      })
      .onConflictDoNothing({ target: syncChangeFeed.actionId })
      .returning({ feedId: syncChangeFeed.feedId });

      if (inserted.length === 0) return { duplicate: true };

      await tx.insert(fleetAuditLog).values({
        serverSeq: nextSeq,
        operatorId: op.operatorId,
        eventType: `${cmd.aggregateType}.command_issued`,
        aggregateType: cmd.aggregateType,
        aggregateId: cmd.aggregateId,
        payload: { commandId: cmd.commandId, type: cmd.type, targetOperatorId: cmd.targetOperatorId },
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      });

      await tx.insert(outbox).values({
        queueName: 'projections',
        payload: { aggregateType: cmd.aggregateType, eventType: `${cmd.aggregateType}.command_issued`, commandId: cmd.commandId, serverSeq: nextSeq.toString() },
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      });

      return { duplicate: false };
    });
  }
}
