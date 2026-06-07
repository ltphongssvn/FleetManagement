// apps/api/src/driver/driver-password-change.controller.ts
// POST /driver/me/password — self-service password change for the
// authenticated driver. JWT-guarded; identity (operatorId + companyId) comes
// from the token via CurrentOperator, never the body, so a forged body cannot
// target another driver. The body carries only currentPassword + newPassword,
// validated by zod before the service is touched.
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { DriverPasswordChangeService } from './driver-password-change.service.js';
const ChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(6).max(128),
});
@UseGuards(JwtGuard)
@Controller('driver/me/password')
export class DriverPasswordChangeController {
  constructor(private readonly service: DriverPasswordChangeService) {}
  @Post()
  @HttpCode(204)
  async change(
    @CurrentOperator() op: OperatorContext,
    @Body() body: z.infer<typeof ChangeSchema>,
  ): Promise<void> {
    const parsed = ChangeSchema.parse(body);
    await this.service.changePassword({
      operatorId: op.operatorId,
      companyId: op.companyId,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
    });
  }
}
