// apps/api/src/driver/driver.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriverMeService } from './driver-me.service.js';
import { DriverMeController } from './driver-me.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [DriverMeController],
  providers: [DriverMeService],
  exports: [DriverMeService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DriverModule {}
