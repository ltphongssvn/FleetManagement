// apps/api/src/health/health.controller.ts
// Liveness vs Readiness split per Kubernetes convention:
// - /health/live: process is up (no deps checked) - LB liveness probe
// - /health/ready: deps reachable - LB readiness probe (excludes traffic if DB down)
import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens.js';

export interface LivenessStatus {
  readonly status: 'ok';
}

export interface ReadinessStatus {
  readonly status: 'ok' | 'degraded';
  readonly database: 'up' | 'down';
}

export interface VersionInfo {
  readonly sha: string;
  readonly shortSha: string;
  readonly branch: string;
  readonly buildTime: string;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('live')
  liveness(): LivenessStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<ReadinessStatus> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch (err) {
      this.logger.error('Readiness check failed', err);
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
  }

  // Build-info self-report: minimal, unauthenticated (sha/branch/time only,
  // no paths or dep versions). Lets a deploy-verification tool ask prod which
  // commit is live. SHA injected by the platform (RAILWAY_GIT_COMMIT_SHA) or an
  // explicit GIT_SHA; unknown off-platform.
  @Get("version")
  version(): VersionInfo {
    const sha = process.env["GIT_SHA"] ?? process.env["RAILWAY_GIT_COMMIT_SHA"] ?? "unknown";
    const branch = process.env["GIT_BRANCH"] ?? process.env["RAILWAY_GIT_BRANCH"] ?? "unknown";
    const buildTime = process.env["BUILD_TIME"] ?? new Date().toISOString();
    const shortSha = sha === "unknown" ? "unknown" : sha.slice(0, 7);
    return { sha, shortSha, branch, buildTime };
  }
}
