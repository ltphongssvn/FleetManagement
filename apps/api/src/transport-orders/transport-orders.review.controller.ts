// apps/api/src/transport-orders/transport-orders.review.controller.ts
// Dispatcher review endpoint: GET /transport-orders/:id returns one order
// (with its road-run + stops, scoped to the calling operator's tenancy).
// Separate controller file so the new review behavior is isolated from the
// pilot-seed POST endpoint and the assigned/trip-history GET endpoints.
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { ListAssignedRow } from './transport-orders.dto.js';
import { TransportOrdersService } from './transport-orders.service.js';
import { TransportOrderNotFoundError } from './transport-orders.errors.js';
const IdParamSchema = z.string().uuid();
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersReviewController {
  constructor(private readonly svc: TransportOrdersService) {}
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentOperator() op: OperatorContext): Promise<ListAssignedRow> {
    const parsed = IdParamSchema.parse(id);
    try {
      return await this.svc.findById(parsed, op);
    } catch (err) {
      if (err instanceof TransportOrderNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
