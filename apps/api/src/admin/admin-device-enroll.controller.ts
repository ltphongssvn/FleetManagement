// apps/api/src/admin/admin-device-enroll.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AdminDeviceEnrollService } from './admin-device-enroll.service.js';

const EnrollSchema = z.object({
  driverId: z.guid(),
  udid: z.string().min(1).max(128),
  platform: z.enum(['ios', 'android', 'web']),
});

@UseGuards(JwtGuard)
@Controller('admin/devices')
export class AdminDeviceEnrollController {
  constructor(private readonly service: AdminDeviceEnrollService) {}

  @Post()
  async create(
    @CurrentOperator() op: OperatorContext,
    @Body() body: z.infer<typeof EnrollSchema>,
  ): Promise<{ deviceId: string }> {
    const parsed = EnrollSchema.parse(body);
    const row = await this.service.enroll({
      driverId: parsed.driverId,
      udid: parsed.udid,
      platform: parsed.platform,
      companyId: op.companyId,
    });
    return { deviceId: row.deviceId };
  }
}
