// apps/api/src/driver/driver.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriverMeService } from './driver-me.service.js';
import { DriverMeController } from './driver-me.controller.js';
import { DriverPasswordChangeService } from './driver-password-change.service.js';
import { DriverPasswordChangeController } from './driver-password-change.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [DriverMeController, DriverPasswordChangeController],
  providers: [DriverMeService, DriverPasswordChangeService],
  exports: [DriverMeService, DriverPasswordChangeService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DriverModule {}
