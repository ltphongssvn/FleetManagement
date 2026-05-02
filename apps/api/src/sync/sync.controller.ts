// apps/api/src/sync/sync.controller.ts
// POST /sync endpoint per PDF "Sync wire protocol".
// Tenancy taken from JwtGuard-attached OperatorContext (defense against IDOR
// where a caller could otherwise inject another tenant's IDs).
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { SyncResponse } from '@fleet/sync-protocol';
import { SyncRequestDto, type SyncRequestInput } from './sync.dto.js';
import { SyncService } from './sync.service.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';

@Controller('sync')
@UseGuards(JwtGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  async post(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<SyncResponse> {
    const req: SyncRequestInput = SyncRequestDto.parse(body);
    return this.sync.processSync(req, op);
  }
}
