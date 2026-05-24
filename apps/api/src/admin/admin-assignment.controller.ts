// apps/api/src/admin/admin-assignment.controller.ts
import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { AdminAssignmentService } from './admin-assignment.service.js';
import type { DriverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';

const CreateSchema = z.object({
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
});

const RevokeSchema = z.object({
  reason: z.string().min(1).max(64),
});

@UseGuards(JwtGuard)
@Controller('admin/driver-vehicle-assignments')
export class AdminAssignmentController {
  constructor(private readonly service: AdminAssignmentService) {}

  @Post()
  async create(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: z.infer<typeof CreateSchema>,
  ): Promise<DriverVehicleAssignment> {
    const parsed = CreateSchema.parse(body);
    return this.service.assign({
      driverId: parsed.driverId,
      vehicleId: parsed.vehicleId,
      companyId: operator.companyId,
      businessUnitId: operator.businessUnitId,
      depotId: operator.depotId,
      legalEntityId: operator.legalEntityId,
    });
  }

  @Delete(':id')
  async revoke(
    @Param('id') id: string,
    @Body() body: z.infer<typeof RevokeSchema>,
  ): Promise<DriverVehicleAssignment> {
    const parsed = RevokeSchema.parse(body);
    return this.service.revoke({ assignmentId: id, reason: parsed.reason });
  }
}
