// apps/api/src/device/device.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceService } from './device.service.js';
import { DeviceEnrollmentService } from './device-enrollment.service.js';
import { DeviceEnrollmentController } from './device-enrollment.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [DeviceEnrollmentController],
  providers: [DeviceService, DeviceEnrollmentService],
  exports: [DeviceService, DeviceEnrollmentService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DeviceModule {}
