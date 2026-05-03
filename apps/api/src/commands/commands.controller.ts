// apps/api/src/commands/commands.controller.ts
// Thin HTTP layer: parse body -> delegate to CommandsService -> push via gateway.
// Tenancy from JwtGuard (defense against IDOR).
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CommandPayloadSchema, type CommandPayload } from './command.dto.js';
import { CommandsGateway } from './commands.gateway.js';
import { CommandsService } from './commands.service.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';

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
  constructor(
    private readonly gateway: CommandsGateway,
    private readonly service: CommandsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async issue(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<IssueCommandResponse> {
    const cmd: CommandPayload = IssueCommandSchema.parse(body);

    const { duplicate } = await this.service.persist(cmd, op);
    if (duplicate) {
      return { commandId: cmd.commandId, status: 'duplicate', recipientCount: 0 };
    }

    const result = this.gateway.pushCommand(cmd);
    return {
      commandId: cmd.commandId,
      status: result.status,
      recipientCount: result.status === 'emitted' ? result.recipientCount : 0,
    };
  }
}
