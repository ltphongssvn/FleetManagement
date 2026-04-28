// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DeviceModule } from './device/device.module.js';
import { HealthModule } from './health/health.module.js';
import { SyncModule } from './sync/sync.module.js';
import { validateEnv } from './config/env.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    DatabaseModule,
    AuthModule,
    DeviceModule,
    HealthModule,
    SyncModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
