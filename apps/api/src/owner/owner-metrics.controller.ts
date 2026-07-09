// apps/api/src/owner/owner-metrics.controller.ts
// GET /owner/metrics/adoption - the company owner's driver-app adoption
// dashboard. Thin pass-through to OwnerMetricsService, scoped to the JWT
// operator's company via CurrentOperator (tenancy NEVER comes from a query
// string). Protected by JwtGuard (authn) + OwnerRoleGuard (fleet-owner realm
// role). Response is the @fleet/sync-protocol OwnerAdoptionMetrics SSOT.
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';
import { JwtGuard } from '../auth/jwt.guard.js';
import { OwnerRoleGuard } from './owner-role.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { OwnerMetricsService } from './owner-metrics.service.js';

@UseGuards(JwtGuard, OwnerRoleGuard)
@Controller('owner/metrics')
export class OwnerMetricsController {
  constructor(private readonly svc: OwnerMetricsService) {}

  @Get('adoption')
  async adoption(@CurrentOperator() op: OperatorContext): Promise<OwnerAdoptionMetrics> {
    return this.svc.adoption({ companyId: op.companyId });
  }
}
