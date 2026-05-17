// apps/api/src/dispatch/dispatch.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DriverAssignmentsController } from './driver-assignments.controller.js';
import { DriverDeliveryController } from './driver-delivery.controller.js';
import { DriverDeliveryService } from './driver-delivery.service.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DispatchController, DriverAssignmentsController, DriverDeliveryController],
  providers: [DriverDeliveryService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DispatchModule {}
