import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
// apps/api/src/commands/commands.service.ts
// Persists a command via the 3 append paths (sync_change_feed + fleet_audit_log
// + outbox) in a single transaction. Idempotent on action_id (replay-safe).
//
// Extracted from CommandsController to keep the controller as a thin HTTP
// layer. Mirrors the service-owns-DB idiom used by manifest.service.ts and
// sync.service.ts.
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import type { FleetDb } from '../database/database.module.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import type { CommandPayload } from './command.dto.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { commandIssuedEventType } from './command-events.js';

export interface PersistResult {
  /** True when action_id already existed (replay). Audit/outbox skipped. */
  readonly duplicate: boolean;
}

@Injectable()
export class CommandsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async persist(cmd: CommandPayload, op: OperatorContext): Promise<PersistResult> {
    return this.db.transaction(async (tx) => {
      const serverSeq = await allocateServerSeq(tx);
      return appendTriWrite(tx, {
        serverSeq,
        actionId: cmd.commandId,
        aggregateType: cmd.aggregateType,
        aggregateId: cmd.aggregateId,
        delta: { type: cmd.type, payload: cmd.payload, targetOperatorId: cmd.targetOperatorId },
        eventType: commandIssuedEventType(cmd.aggregateType),
        auditPayload: {
          commandId: cmd.commandId,
          type: cmd.type,
          targetOperatorId: cmd.targetOperatorId,
        },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: {
          aggregateType: cmd.aggregateType,
          eventType: commandIssuedEventType(cmd.aggregateType),
          commandId: cmd.commandId,
        },
        op,
        idempotent: true,
      });
    });
  }
}
