// apps/api/src/driver/driver-me.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { DriverMeService, type DriverMeResult } from './driver-me.service.js';

@UseGuards(JwtGuard)
@Controller('driver')
export class DriverMeController {
  constructor(private readonly service: DriverMeService) {}

  @Get('me')
  async me(@CurrentOperator() operator: OperatorContext): Promise<DriverMeResult> {
    return this.service.fetchMe({ operatorId: operator.operatorId, companyId: operator.companyId });
  }
}
