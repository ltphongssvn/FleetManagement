// apps/api/src/commands/commands.controller.ts
// HTTP endpoint that ops-web Server Actions call to dispatch commands.
// Path: ops-web POST /commands -> writes 3 append paths -> Socket.IO push.
// Tenancy comes from JwtGuard (defense against IDOR).
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CommandPayloadSchema, type CommandPayload } from './command.dto.js';
import { CommandsGateway } from './commands.gateway.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { fleetAuditLog, syncChangeFeed, outbox } from '../database/schema/index.js';
import { sql } from 'drizzle-orm';

const IssueCommandSchema = CommandPayloadSchema;
export type IssueCommandInput = z.infer<typeof IssueCommandSchema>;

export interface IssueCommandResponse {
  readonly commandId: string;
  readonly status: 'emitted' | 'no_socket';
  readonly recipientCount: number;
}

@Controller('commands')
@UseGuards(JwtGuard)
export class CommandsController {
  constructor(
    private readonly gateway: CommandsGateway,
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async issue(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<IssueCommandResponse> {
    const cmd: CommandPayload = IssueCommandSchema.parse(body);

    // Three append paths in same tx (PDF "Command flow"). Idempotent on
    // action_id (UNIQUE in sync_change_feed): replays return success without
    // re-emitting audit/outbox rows. server_seq from fleet_server_seq sequence
    // (atomic, lock-free, monotonic).
    //
    // On conflict, the consumed sequence value is "wasted" — acceptable because
    // server_seq is documented as monotonic gap-tolerant (PDF §"Database").
    await this.db.transaction(async (tx) => {
      const seqRow = await tx.execute(
        sql<{ next_seq: string }>`SELECT nextval('fleet_server_seq')::text AS next_seq`,
      );
      const rows = (seqRow as unknown as { rows: readonly { next_seq: string }[] }).rows;
      const nextSeqStr = rows[0]?.next_seq;
      if (nextSeqStr === undefined) throw new Error('fleet_server_seq nextval returned no row');
      const nextSeq = BigInt(nextSeqStr);

      // Insert change feed first; if action_id is a replay, onConflictDoNothing
      // returns no rows and we skip audit+outbox to preserve at-most-once
      // side effects.
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

      if (inserted.length === 0) {
        // Replay: row already exists. Audit+outbox were emitted on the original
        // call; emitting them again would double-publish to projections/ERP.
        return;
      }

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
    });

    // Push via Socket.IO (real-time delivery; reconciler covers offline drivers).
    const result = this.gateway.pushCommand(cmd);
    return {
      commandId: cmd.commandId,
      status: result.status,
      recipientCount: result.status === 'emitted' ? result.recipientCount : 0,
    };
  }
}
