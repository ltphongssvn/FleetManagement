// apps/api/src/admin/admin-drivers-update.controller.ts
// PATCH /admin/drivers/:id  — rename driver (fullName, optional phone)
// DELETE /admin/drivers/:id — soft-delete (active=false)
// Tenancy comes from JWT via CurrentOperator. Zod parses the body so any
// extraneous key from a hostile client (e.g. an injected companyId attempting
// IDOR) is silently stripped before the call — only fullName/phone survive.
import { Body, Controller, Delete, HttpCode, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DriverNameSchema, type OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { UuidParamSchema } from '../common/uuid-param.schema.js';
import { AdminDriversUpdateService } from './admin-drivers-update.service.js';
const UpdateSchema = z.object({
  fullName: DriverNameSchema,
  phone: z.string().min(8).max(32).optional(),
});
@UseGuards(JwtGuard)
@Controller('admin/drivers')
export class AdminDriversUpdateController {
  constructor(private readonly service: AdminDriversUpdateService) {}
  @Patch(':id')
  async update(
    @CurrentOperator() op: OperatorContext,
    @Param('id') driverId: string,
    @Body() body: z.input<typeof UpdateSchema>,
  ): Promise<{ ok: true }> {
    const parsedDriverId = UuidParamSchema.parse(driverId);
    const parsed = UpdateSchema.parse(body);
    await this.service.update({
      driverId: parsedDriverId,
      companyId: op.companyId,
      fullName: parsed.fullName,
      ...(parsed.phone !== undefined ? { phone: parsed.phone } : {}),
    });
    return { ok: true };
  }
  @Delete(':id')
  @HttpCode(200)
  async softDelete(
    @CurrentOperator() op: OperatorContext,
    @Param('id') driverId: string,
  ): Promise<{ ok: true }> {
    await this.service.softDelete({
      driverId: UuidParamSchema.parse(driverId),
      companyId: op.companyId,
    });
    return { ok: true };
  }
}
