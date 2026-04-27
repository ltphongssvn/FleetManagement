// apps/api/src/health/health.controller.ts
// Liveness + readiness check. DB ping prevents 200 OK on dead database.
import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens.js';

export interface HealthStatus {
  readonly status: 'ok' | 'degraded';
  readonly database: 'up' | 'down';
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch (err) {
      this.logger.error('Database health check failed', err);
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
  }
}
