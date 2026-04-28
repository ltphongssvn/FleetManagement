// apps/api/src/manifest/manifest.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ManifestController } from './manifest.controller.js';
import { ManifestService } from './manifest.service.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ManifestController],
  providers: [ManifestService],
  exports: [ManifestService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ManifestModule {}
