// apps/api/src/dispatch/driver-delivery.controller.ts
// POST /driver/assignments/:roadRunId/{accept,start,complete} — driver
// delivery lifecycle transitions, JWT-guarded, operator-scoped.
import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { DriverDeliveryService, type DeliveryTransitionResult } from './driver-delivery.service.js';

@Controller('driver/assignments')
@UseGuards(JwtGuard)
export class DriverDeliveryController {
  constructor(private readonly svc: DriverDeliveryService) {}

  @Post(':roadRunId/accept')
  accept(
    @Param('roadRunId') roadRunId: string,
    @CurrentOperator() op: OperatorContext,
  ): Promise<DeliveryTransitionResult> {
    return this.svc.accept(roadRunId, op);
  }

  @Post(':roadRunId/start')
  start(
    @Param('roadRunId') roadRunId: string,
    @CurrentOperator() op: OperatorContext,
  ): Promise<DeliveryTransitionResult> {
    return this.svc.start(roadRunId, op);
  }

  @Post(':roadRunId/complete')
  complete(
    @Param('roadRunId') roadRunId: string,
    @CurrentOperator() op: OperatorContext,
  ): Promise<DeliveryTransitionResult> {
    return this.svc.complete(roadRunId, op);
  }
}
