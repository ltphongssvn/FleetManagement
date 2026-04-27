// apps/api/test/health.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { HealthController } from '../src/health/health.controller.js';

function makePool(queryImpl: () => Promise<unknown>): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

describe('@fleet/api - HealthController', () => {
  it('returns ok + database up when SELECT 1 succeeds', async () => {
    const pool = makePool(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    const controller = new HealthController(pool);
    await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('throws ServiceUnavailableException when DB query fails', async () => {
    const pool = makePool(() => Promise.reject(new Error('connection refused')));
    const controller = new HealthController(pool);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
