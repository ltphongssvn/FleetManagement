// apps/api/src/metrics/metrics.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { MetricsService, type MetricsSnapshot } from './metrics.service.js';

@Controller('metrics')
@UseGuards(JwtGuard)
export class MetricsController {
  constructor(private readonly svc: MetricsService) {}

  @Get('snapshot')
  async snapshot(): Promise<MetricsSnapshot> {
    return this.svc.snapshot();
  }
}
