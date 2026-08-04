// apps/api/test/health.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { HealthController } from '../src/health/health.controller.js';

function makePool(queryImpl: () => Promise<unknown>): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

// Liveness and readiness must never touch the worker heartbeat: readiness
// decides whether this instance receives traffic, so a dependency on the worker
// would pull api OUT of the load balancer during a worker outage. This reader
// throws, so any accidental coupling fails these tests loudly instead of
// passing on a stub that quietly answers.
const noWorkerRead = (): Promise<string | null> => {
  throw new Error('liveness/readiness must not read worker provenance');
};

function makeController(pool: Pool): HealthController {
  return new HealthController(pool, noWorkerRead);
}

describe('@fleet/api - HealthController', () => {
  describe('liveness', () => {
    it('returns ok without checking deps', () => {
      const pool = makePool(() => Promise.reject(new Error('db down')));
      const controller = makeController(pool);
      expect(controller.liveness()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness', () => {
    it('returns ok + database up when SELECT 1 succeeds', async () => {
      const pool = makePool(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
      const controller = makeController(pool);
      await expect(controller.readiness()).resolves.toEqual({ status: 'ok', database: 'up' });
    });

    it('throws ServiceUnavailableException when DB query fails', async () => {
      const pool = makePool(() => Promise.reject(new Error('connection refused')));
      const controller = makeController(pool);
      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
