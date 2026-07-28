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

// Read the first env var that holds a real value, treating BLANK as ABSENT.
//
// Docker substitutes an ARG that was never passed with the EMPTY STRING, so a
// Dockerfile line of the form ENV GIT_SHA=<unpassed ARG> bakes a set-but-blank
// variable into the image. Nullish coalescing counts blank as PRESENT, so that
// baked empty value shadowed the SHA the platform injects at runtime and
// /health/version reported an empty sha in production indefinitely -- the
// deploy-verification tool could never confirm which commit was live.
//
// Trimming and discarding blanks is the only check that survives that, and it
// covers a whitespace-only value for free. Fixed here rather than in the
// Dockerfile because the reader must be correct for ANY platform whose build
// does not forward the arg, not just for one Dockerfile spelling.
function readEnvValue(names: readonly string[]): string | null {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return null;
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
    const sha = readEnvValue(['GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA']) ?? 'unknown';
    const branch = readEnvValue(['GIT_BRANCH', 'RAILWAY_GIT_BRANCH']) ?? 'unknown';
    const buildTime = readEnvValue(['BUILD_TIME']) ?? new Date().toISOString();
    const shortSha = sha === 'unknown' ? 'unknown' : sha.slice(0, 7);
    return { sha, shortSha, branch, buildTime };
  }
}
