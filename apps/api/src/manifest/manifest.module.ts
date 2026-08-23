// apps/api/src/manifest/manifest.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ManifestController, IntakeCallbackController, ExtractionCallbackController, ManualNetWeightController } from './manifest.controller.js';
import { ManifestService } from './manifest.service.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ManifestController, IntakeCallbackController, ExtractionCallbackController, ManualNetWeightController],
  providers: [ManifestService],
  exports: [ManifestService],
})

export class ManifestModule {}
