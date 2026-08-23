// apps/api/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAssignmentService } from './admin-assignment.service.js';
import { AdminAssignmentController } from './admin-assignment.controller.js';
import { AdminDriversListService } from './admin-drivers-list.service.js';
import { AdminOrderTimelineService } from './admin-order-timeline.service.js';
import { AdminOrderTimelineController } from './admin-order-timeline.controller.js';
import { AdminDriversListController } from './admin-drivers-list.controller.js';
import { AdminDeviceBindingService } from './admin-device-binding.service.js';
import { AdminDeviceBindingController } from './admin-device-binding.controller.js';
import {
  AdminDriversCreateService,
  BCRYPT_HASH,
  type BcryptHashFn,
} from './admin-drivers-create.service.js';
import { AdminDriversCreateController } from './admin-drivers-create.controller.js';
import { AdminDriversUpdateService } from './admin-drivers-update.service.js';
import { AdminDriversUpdateController } from './admin-drivers-update.controller.js';
import { AdminDriversResetPasswordService } from './admin-drivers-reset-password.service.js';
import { AdminDriversResetPasswordController } from './admin-drivers-reset-password.controller.js';
import * as bcrypt from 'bcryptjs';
const bcryptHashProvider = {
  provide: BCRYPT_HASH,
  useValue: ((plain: string, rounds: number) =>
    bcrypt.hash(plain, rounds)) satisfies BcryptHashFn,
};
@Module({
  imports: [AuthModule],
  controllers: [
    AdminAssignmentController,
    AdminDriversListController,
    AdminOrderTimelineController,
    AdminDeviceBindingController,
    AdminDriversCreateController,
    AdminDriversUpdateController,
    AdminDriversResetPasswordController,
  ],
  providers: [
    AdminOrderTimelineService,
    AdminAssignmentService,
    AdminDriversListService,
    AdminDeviceBindingService,
    AdminDriversCreateService,
    AdminDriversUpdateService,
    AdminDriversResetPasswordService,
    bcryptHashProvider,
  ],
  exports: [
    AdminOrderTimelineService,
    AdminAssignmentService,
    AdminDriversListService,
    AdminDriversCreateService,
    AdminDriversUpdateService,
    AdminDriversResetPasswordService,
  ],
})

export class AdminModule {}
