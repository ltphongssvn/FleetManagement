// apps/api/src/admin/admin-drivers-list.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { AdminDriversListService, type DriverListRow } from './admin-drivers-list.service.js';

@UseGuards(JwtGuard)
@Controller('admin/drivers')
export class AdminDriversListController {
  constructor(private readonly service: AdminDriversListService) {}

  @Get()
  async list(@CurrentOperator() op: OperatorContext): Promise<readonly DriverListRow[]> {
    return this.service.list({ companyId: op.companyId });
  }
}
