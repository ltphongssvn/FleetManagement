// apps/api/src/sync/sync.module.ts
import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SyncModule {}
