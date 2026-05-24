// apps/api/src/device/device-enrollment.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { DeviceEnrollmentService } from './device-enrollment.service.js';

const EnrollRequestSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().min(1).max(32),
  expoPushToken: z.string().min(1).max(256).optional(),
});

@UseGuards(JwtGuard)
@Controller('devices')
export class DeviceEnrollmentController {
  constructor(private readonly service: DeviceEnrollmentService) {}

  @Post('enroll')
  async enroll(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: z.infer<typeof EnrollRequestSchema>,
  ): Promise<{ deviceId: string }> {
    const parsed = EnrollRequestSchema.parse(body);
    const row = await this.service.enroll({
      operatorId: operator.operatorId,
      platform: parsed.platform,
      appVersion: parsed.appVersion,
      companyId: operator.companyId,
      businessUnitId: operator.businessUnitId,
      depotId: operator.depotId,
      legalEntityId: operator.legalEntityId,
      ...(parsed.expoPushToken !== undefined ? { expoPushToken: parsed.expoPushToken } : {}),
    });
    return { deviceId: row.deviceId };
  }
}
