// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { validateEnv } from './config/env.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    DatabaseModule,
    HealthModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
