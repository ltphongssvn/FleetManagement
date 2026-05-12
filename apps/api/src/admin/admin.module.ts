// apps/api/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAssignmentService } from './admin-assignment.service.js';
import { AdminAssignmentController } from './admin-assignment.controller.js';
import { AdminDriversListService } from './admin-drivers-list.service.js';
import { AdminDriversListController } from './admin-drivers-list.controller.js';
import { AdminDeviceEnrollService } from './admin-device-enroll.service.js';
import { AdminDeviceEnrollController } from './admin-device-enroll.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [AdminAssignmentController, AdminDriversListController, AdminDeviceEnrollController],
  providers: [AdminAssignmentService, AdminDriversListService, AdminDeviceEnrollService],
  exports: [AdminAssignmentService, AdminDriversListService, AdminDeviceEnrollService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
