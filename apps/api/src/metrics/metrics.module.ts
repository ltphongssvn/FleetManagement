// apps/api/src/metrics/metrics.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
