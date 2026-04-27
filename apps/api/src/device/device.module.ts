// apps/api/src/device/device.module.ts
import { Module } from '@nestjs/common';
import { DeviceService } from './device.service.js';

@Module({
  providers: [DeviceService],
  exports: [DeviceService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DeviceModule {}
