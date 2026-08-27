// apps/api/src/projections/projections.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProjectionRunnerService } from './projection-runner.service.js';
import { ProjectionRebuildService } from './projection-rebuild.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [ProjectionRunnerService, ProjectionRebuildService],
  exports: [ProjectionRunnerService, ProjectionRebuildService],
})
export class ProjectionsModule {}
