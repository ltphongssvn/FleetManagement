// apps/api/src/transport-orders/transport-orders.controller.ts
// Pilot seed endpoint. Disabled unless FLEET_PILOT_SEED_ENABLED=true.
//
// T3 (2026-Q2): after a successful create, drain the dispatch_board
// projection inline before returning so the ops-web dispatcher's
// Lệnh điều xe table reflects the new row immediately when the server
// action settles. Mirrors the pattern used by TransportOrdersCancelController
// (T5) — the scheduler's 5s projection poll is too slow for an interactive
// create flow; without an inline drain the dispatcher must hit F5.
import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { CreateTransportOrderSchema, type CreateTransportOrderResponse, type ListAssignedResponse, type TripHistoryResponse } from './transport-orders.dto.js';
import { TransportOrdersService } from './transport-orders.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersController {
  constructor(
    private readonly svc: TransportOrdersService,
    private readonly projectionRunner: ProjectionRunnerService,
  ) {}
  @Post()
  async create(@Body() body: unknown, @CurrentOperator() op: OperatorContext): Promise<CreateTransportOrderResponse> {
    if (process.env['FLEET_PILOT_SEED_ENABLED'] === 'false') {
      throw new ForbiddenException('seed endpoint disabled');
    }
    const input = CreateTransportOrderSchema.parse(body);
    const result = await this.svc.create(input, op);
    // Synchronous projection drain: ensures the dispatch_board_projection
    // row materializes BEFORE the action returns 'created' to ops-web, so
    // the subsequent router.refresh() finds the row on the very first GET
    // /dispatch/board call. Without this, the dispatcher must manually F5.
    await this.projectionRunner.drainOnce(op.companyId);
    return result;
  }
  @Get('assigned')
  async listAssigned(@CurrentOperator() op: OperatorContext): Promise<ListAssignedResponse> {
    return this.svc.listAssigned(op);
  }
  // Completed runs grouped by VN-timezone month for the calling driver.
  @Get('trip-history')
  async tripHistory(@CurrentOperator() op: OperatorContext): Promise<TripHistoryResponse> {
    return this.svc.tripHistory(op);
  }
}
