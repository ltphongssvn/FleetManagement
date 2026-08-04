// apps/api/src/health/health.controller.ts
// Liveness vs Readiness split per Kubernetes convention:
// - /health/live: process is up (no deps checked) - LB liveness probe
// - /health/ready: deps reachable - LB readiness probe (excludes traffic if DB down)
// - /health/version: build provenance - which COMMIT of THIS service is live
// - /health/worker-version: build provenance of the WORKER (see below)
import {
  Controller, Get, Inject, Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { buildDeployVersion, DeployVersionSchema, type DeployVersion } from '@fleet/sync-protocol';
import { PG_POOL } from '../database/database.tokens.js';
import { WORKER_PROVENANCE_READER } from './worker-provenance.token.js';

// api-only shapes: single-use, no second emitter, crossing no trust boundary,
// so they stay plain TypeScript. Only the version payload is answered by more
// than one service and parsed by CI, which is what makes it a shared contract.
export interface LivenessStatus {
  readonly status: 'ok';
}

export interface ReadinessStatus {
  readonly status: 'ok' | 'degraded';
  readonly database: 'up' | 'down';
}

/** Reads the worker's heartbeat. A one-method port, not an ioredis type: the
 *  controller needs exactly one Redis capability, and narrowing it here keeps
 *  the test double honest without stubbing a whole client. */
export type WorkerProvenanceReader = () => Promise<string | null>;

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(WORKER_PROVENANCE_READER) private readonly readWorkerProvenance: WorkerProvenanceReader,
  ) {}

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

  // Build-info self-report: minimal, unauthenticated (sha/branch/time only, no
  // paths or dep versions). Lets deploy-stamp --verify ask production which
  // commit is live and FAIL THE DEPLOY when it is not the one just shipped --
  // the check liveness cannot make, because /health/ready answers 200 from the
  // PREVIOUS container after a failed deploy.
  //
  // The payload shape, the blank-vs-absent env rule and the GIT_* over
  // RAILWAY_GIT_* precedence live in @fleet/sync-protocol: ops-web and the
  // worker answer the SAME contract and one CI gate parses all three.
  @Get('version')
  version(): DeployVersion {
    return buildDeployVersion(process.env, () => new Date().toISOString());
  }

  // The WORKER's provenance, read from the TTL'd heartbeat it writes to Redis
  // at boot. The worker has no HTTP surface and no public Railway domain, so CI
  // cannot probe it; this is how the worker deploy becomes verifiable at all
  // (its deploy step was `sleep 30; railway logs ... || true` -- a gate that
  // could not fail). The heartbeat proves the worker booted AND reached its
  // dependencies, which a log line cannot.
  //
  // DELIBERATELY NOT PART OF /health/ready: readiness decides whether this
  // instance receives traffic, so making it depend on the worker would pull api
  // OUT of the load balancer during a worker outage. Here, failing closed costs
  // nothing because nothing is routed on it.
  //
  // Every failure is distinct and 503, never a placeholder 200: an absent key
  // (worker never booted, or died and its TTL lapsed), an unparseable value,
  // and an unreachable Redis are all deploy failures, and collapsing them into
  // a cheerful "unknown" is what lets a broken deploy look green. The raw
  // stored value is never echoed back.
  @Get('worker-version')
  async workerVersion(): Promise<DeployVersion> {
    let raw: string | null;
    try {
      raw = await this.readWorkerProvenance();
    } catch (err) {
      this.logger.error('Worker provenance read failed', err);
      throw new ServiceUnavailableException('worker provenance could not be read');
    }
    if (raw === null) {
      throw new ServiceUnavailableException(
        'no worker provenance recorded: the worker has not booted, or its heartbeat expired',
      );
    }
    try {
      return DeployVersionSchema.parse(JSON.parse(raw));
    } catch {
      throw new ServiceUnavailableException('stored worker provenance is not valid');
    }
  }
}
