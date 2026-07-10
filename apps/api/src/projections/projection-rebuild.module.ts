// apps/api/src/projections/projection-rebuild.module.ts
// Minimal standalone module for the projection-rebuild CLI (follow-up #5).
// Boots via NestFactory.createApplicationContext (no HTTP). Imports only the
// config + database + projections wiring the rebuild needs, so DI lifecycle
// (Pool open/close via DatabaseModule.onModuleDestroy) is preserved WITHOUT
// pulling in AppModule's OIDC/S3/JWT config validation.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateRebuildEnv } from '../config/env.config.js';
import { DatabaseModule } from '../database/database.module.js';
import { ProjectionsModule } from './projections.module.js';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateRebuildEnv, cache: true }),
    DatabaseModule,
    ProjectionsModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ProjectionRebuildModule {}
