// apps/api/src/commands/commands.controller.ts
// Thin HTTP layer: parse body -> delegate to CommandsService -> push via gateway.
// Tenancy from JwtGuard (defense against IDOR).
import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CommandPayloadSchema, type CommandPayload } from './command.dto.js';
import { CommandsGateway } from './commands.gateway.js';
import { CommandsService } from './commands.service.js';
import { TenantPolicy } from '../auth/tenant-policy.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { tagActiveSpan } from '../observability/otel.js';

const IssueCommandSchema = CommandPayloadSchema;
export type IssueCommandInput = z.infer<typeof IssueCommandSchema>;

export interface IssueCommandResponse {
  readonly commandId: string;
  readonly status: 'emitted' | 'no_socket' | 'duplicate';
  readonly recipientCount: number;
}

@Controller('commands')
@UseGuards(JwtGuard)
export class CommandsController {
  private readonly logger = new Logger(CommandsController.name);

  constructor(
    private readonly gateway: CommandsGateway,
    private readonly service: CommandsService,
    private readonly tenantPolicy: TenantPolicy,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async issue(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<IssueCommandResponse> {
    const cmd: CommandPayload = IssueCommandSchema.parse(body);

    // Authorization: re-verify body-controlled tenant references against op.
    // JwtGuard only proves op's tenancy; targetOperatorId / aggregateId come
    // from the request body and could otherwise enable cross-tenant IDOR.
    await this.tenantPolicy.assertOperatorInTenant(cmd.targetOperatorId, op);
    await this.tenantPolicy.assertAggregateInTenant(cmd.aggregateType, cmd.aggregateId, op);

    const { duplicate } = await this.service.persist(cmd, op);
    if (duplicate) {
      tagActiveSpan({
        'command.id': cmd.commandId,
        'command.target_operator': cmd.targetOperatorId,
        'command.outcome': 'duplicate',
      });
      return { commandId: cmd.commandId, status: 'duplicate', recipientCount: 0 };
    }
    tagActiveSpan({
      'command.id': cmd.commandId,
      'command.target_operator': cmd.targetOperatorId,
      'command.outcome': 'persisted',
    });

    // Push is best-effort: DB commit is the durable record (sync_change_feed +
    // outbox). If gateway throws (e.g., adapter unavailable during shutdown),
    // surface as no_socket so the driver picks it up via /sync poll and the
    // reconciler covers WS-connected drivers via push fallback.
    let result;
    try {
      result = this.gateway.pushCommand(cmd);
    } catch (err) {
      this.logger.warn(
        `pushCommand threw for ${cmd.commandId}; durable in DB. ${err instanceof Error ? err.message : String(err)}`,
      );
      return { commandId: cmd.commandId, status: 'no_socket', recipientCount: 0 };
    }
    return {
      commandId: cmd.commandId,
      status: result.status,
      recipientCount: result.status === 'emitted' ? result.recipientCount : 0,
    };
  }
}
