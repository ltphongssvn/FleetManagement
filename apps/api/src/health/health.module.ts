// apps/api/src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class HealthModule {}
