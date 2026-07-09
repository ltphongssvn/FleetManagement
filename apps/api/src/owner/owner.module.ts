// apps/api/src/owner/owner.module.ts
// Owner dashboard module: registers the metrics service (with a real
// wall-clock NowFn bound to OWNER_METRICS_NOW - tests inject a fixed clock
// instead), the fleet-owner role guard, and the controller. AuthModule
// supplies IDENTITY_PROVIDER for JwtGuard + the OperatorContext factory;
// DatabaseModule supplies DRIZZLE_DB for the aggregation service.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { OwnerMetricsController } from './owner-metrics.controller.js';
import { OwnerMetricsService, OWNER_METRICS_NOW, type NowFn } from './owner-metrics.service.js';
import { OwnerRoleGuard } from './owner-role.guard.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OwnerMetricsController],
  providers: [
    OwnerMetricsService,
    OwnerRoleGuard,
    { provide: OWNER_METRICS_NOW, useValue: (() => new Date()) satisfies NowFn },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OwnerModule {}
