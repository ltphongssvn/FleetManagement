// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ProjectionsModule } from '../projections/projections.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [ConfigModule, OutboxModule, ProjectionsModule],
  providers: [SchedulerService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SchedulerModule {}
