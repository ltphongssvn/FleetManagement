// apps/api/src/transport-orders/transport-orders.review.controller.ts
// Dispatcher review endpoint: GET /transport-orders/:id returns one order
// (with its road-run + stops, scoped to the calling dispatcher's company).
// Separate controller file so the new review behavior is isolated from the
// pilot-seed POST endpoint and the assigned/trip-history GET endpoints.
//
// T5 (2026): the :id param accepts EITHER a transport_order UUID or the
// human-readable XTT.MM-NNN external_ref. The dispatch board links rows by
// external_ref so dispatchers reach the review page from there directly;
// when an L0 test or external integration passes a UUID we still honour
// that form. The service-side method findByCompanyIdOrRef is company-
// scoped, not operator-scoped, so the dispatcher can review any order
// in the company regardless of which driver the road_run is assigned to
// (single-company deployment per Frozen Stack).
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidParamSchema } from '../common/uuid-param.schema.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { ListAssignedRow } from './transport-orders.dto.js';
import { TransportOrdersService } from './transport-orders.service.js';
import { TransportOrderNotFoundError } from './transport-orders.errors.js';
// Accept either a UUID or an XTT.MM-NNN-style external_ref. The external_ref
// pattern is intentionally narrow (uppercase letters + '.' + digits/letters)
// to refuse arbitrary strings as the URL :id param.
const UuidSchema = UuidParamSchema; // Axis-2 SSOT (2026-07-07): was local z.guid()
const ExternalRefSchema = z.string().regex(/^[A-Z][A-Z0-9]*\.[A-Za-z0-9_-]+$/);
const IdOrRefSchema = z.union([UuidSchema, ExternalRefSchema]);
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersReviewController {
  constructor(private readonly svc: TransportOrdersService) {}
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentOperator() op: OperatorContext,
  ): Promise<ListAssignedRow> {
    const parsed = IdOrRefSchema.parse(id);
    try {
      return await this.svc.findByCompanyIdOrRef(parsed, op);
    } catch (err) {
      if (err instanceof TransportOrderNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
