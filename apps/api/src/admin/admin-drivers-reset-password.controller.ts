// apps/api/src/admin/admin-drivers-reset-password.controller.ts
// POST /admin/drivers/:id/reset-password — service-desk password reset.
// JWT-guarded. Actor identity + full tenancy come from the token via
// CurrentOperator, never the body, so a forged body cannot spoof the actor or
// cross tenants. Body = newPassword only (no current password: service-desk
// reset). zod strips unknown keys (e.g. an injected currentPassword) before
// the service is touched. The actor's tenancy is threaded through so the audit
// log row is written with valid tenancy columns.
import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AdminDriversResetPasswordService } from './admin-drivers-reset-password.service.js';
const ResetSchema = z.object({
  newPassword: z.string().min(6).max(128),
});
@UseGuards(JwtGuard)
@Controller('admin/drivers')
export class AdminDriversResetPasswordController {
  constructor(private readonly service: AdminDriversResetPasswordService) {}
  @Post(':id/reset-password')
  @HttpCode(204)
  async reset(
    @CurrentOperator() op: OperatorContext,
    @Param('id') driverId: string,
    @Body() body: z.input<typeof ResetSchema>,
  ): Promise<void> {
    const parsed = ResetSchema.parse(body);
    await this.service.resetPassword({
      driverId,
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      actorOperatorId: op.operatorId,
      newPassword: parsed.newPassword,
    });
  }
}
