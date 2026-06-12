// apps/api/src/admin/admin-order-timeline.controller.ts
// GET /admin/orders/:externalRef/timeline — dispatcher-facing forensic timeline.
// Validates the OUTGOING response against the Zod contract (drift guard, same
// dev-time discipline as the dispatch board contract).
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OrderTimelineSchema, type OrderTimeline } from '@fleet/sync-protocol';
import { JwtGuard } from '../auth/jwt.guard.js';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { AdminOrderTimelineService } from './admin-order-timeline.service.js';

@UseGuards(JwtGuard)
@Controller('admin/orders')
export class AdminOrderTimelineController {
  constructor(private readonly service: AdminOrderTimelineService) {}

  @Get(':externalRef/timeline')
  async timeline(
    @Param('externalRef') externalRef: string,
    @CurrentOperator() op: OperatorContext,
  ): Promise<OrderTimeline> {
    const result = await this.service.getByExternalRef({ externalRef, companyId: op.companyId });
    return OrderTimelineSchema.parse(result);
  }
}
