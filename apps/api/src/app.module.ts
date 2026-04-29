// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    DatabaseModule,
    AuthModule,
    DeviceModule,
    HealthModule,
    StorageModule,
    SyncModule,
    CommandsModule,
    ManifestModule, OutboxModule, ProjectionsModule, DispatchModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
