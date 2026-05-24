// apps/api/src/projections/projections.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProjectionRunnerService } from './projection-runner.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [ProjectionRunnerService],
  exports: [ProjectionRunnerService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ProjectionsModule {}
