// apps/api/src/transport-orders/transport-orders.controller.ts
// Pilot seed endpoint. Disabled unless FLEET_PILOT_SEED_ENABLED=true.
//
// T3 (2026-Q2): after a successful create, drain the dispatch_board
// projection inline before returning so the ops-web dispatcher's
// Lenh dieu xe table reflects the new row immediately when the server
// action settles. Mirrors the pattern used by TransportOrdersCancelController
// (T5) -- the scheduler's 5s projection poll is too slow for an interactive
// create flow; without an inline drain the dispatcher must hit F5.
//
// Driver reads (2026 status partition): GET /transport-orders/assigned returns
// only ACTIVE runs (completed excluded so they stop polluting the live list);
// GET /transport-orders/completed is the paginated + searchable archive of the
// caller's completed runs. The completed route parses its raw query string
// through the SSOT DriverCompletedPageQuerySchema at the trust boundary
// (coerce + defaults + .strict()), then delegates to svc.listCompleted.
import { Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import {
  CreateTransportOrderSchema,
  type CreateTransportOrderResponse,
  type ListAssignedResponse,
  type TripHistoryResponse,
} from './transport-orders.dto.js';
import {
  DriverCompletedPageQuerySchema,
  type DriverCompletedPageResponse,
} from '@fleet/sync-protocol';
import { TransportOrdersService } from './transport-orders.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import { ConfigService } from '@nestjs/config';
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersController {
  constructor(
    private readonly svc: TransportOrdersService,
    private readonly projectionRunner: ProjectionRunnerService,
    private readonly config: ConfigService,
  ) {}
  @Post()
  async create(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<CreateTransportOrderResponse> {
    // Factor III: read the coerced boolean flag from the validated boundary.
    if (!this.config.get<boolean>('FLEET_PILOT_SEED_ENABLED')) {
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
  // Paginated + searchable archive of the caller's COMPLETED runs. Tenancy
  // comes from the JWT (CurrentOperator), never the query string (no IDOR),
  // mirroring listAssigned + the dispatch board page. Raw query is parsed by
  // the SSOT DriverCompletedPageQuerySchema (coerce, defaults, .strict()); a
  // stray key (e.g. group) is a 400 by design -- this endpoint IS the finished
  // partition, so there is no group toggle.
  @Get('completed')
  async listCompleted(
    @CurrentOperator() op: OperatorContext,
    @Query() query: Record<string, unknown>,
  ): Promise<DriverCompletedPageResponse> {
    const parsed = DriverCompletedPageQuerySchema.parse(query);
    return this.svc.listCompleted(op, parsed);
  }
  // Completed runs grouped by VN-timezone month for the calling driver.
  @Get('trip-history')
  async tripHistory(@CurrentOperator() op: OperatorContext): Promise<TripHistoryResponse> {
    return this.svc.tripHistory(op);
  }
}
