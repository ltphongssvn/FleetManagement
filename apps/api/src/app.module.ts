// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AuthModule } from './auth/auth.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DeviceModule } from './device/device.module.js';
import { HealthModule } from './health/health.module.js';
import { ManifestModule } from './manifest/manifest.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SyncModule } from './sync/sync.module.js';
import { validateEnv } from './config/env.config.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { TransportOrdersModule } from './transport-orders/transport-orders.module.js';
import { ConfigClientModule } from './config-client/config-client.module.js';
import { ErpInboundModule } from './erp-inbound/erp-inbound.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    SentryModule.forRoot(),
    DatabaseModule,
    AuthModule,
    DeviceModule,
    HealthModule,
    StorageModule,
    SyncModule,
    CommandsModule,
    ManifestModule,
    OutboxModule,
    ProjectionsModule,
    DispatchModule,
    SchedulerModule,
    TransportOrdersModule,
    ConfigClientModule,
    ErpInboundModule,
    MetricsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
