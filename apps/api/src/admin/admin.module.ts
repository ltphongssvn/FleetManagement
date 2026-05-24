// apps/api/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAssignmentService } from './admin-assignment.service.js';
import { AdminAssignmentController } from './admin-assignment.controller.js';
import { AdminDriversListService } from './admin-drivers-list.service.js';
import { AdminDriversListController } from './admin-drivers-list.controller.js';
import { AdminDeviceEnrollService } from './admin-device-enroll.service.js';
import { AdminDeviceEnrollController } from './admin-device-enroll.controller.js';
import {
  AdminDriversCreateService,
  BCRYPT_HASH,
  type BcryptHashFn,
} from './admin-drivers-create.service.js';
import { AdminDriversCreateController } from './admin-drivers-create.controller.js';
import { AdminDriversUpdateService } from './admin-drivers-update.service.js';
import { AdminDriversUpdateController } from './admin-drivers-update.controller.js';
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
    AdminDeviceEnrollController,
    AdminDriversCreateController,
    AdminDriversUpdateController,
  ],
  providers: [
    AdminAssignmentService,
    AdminDriversListService,
    AdminDeviceEnrollService,
    AdminDriversCreateService,
    AdminDriversUpdateService,
    bcryptHashProvider,
  ],
  exports: [
    AdminAssignmentService,
    AdminDriversListService,
    AdminDeviceEnrollService,
    AdminDriversCreateService,
    AdminDriversUpdateService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
