// apps/api/test/pglite-smoke.test.ts
// Smoke test: does PGLite load real drizzle migrations + accept SyncService?
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { SyncService } from '../src/sync/sync.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { createSyncCursor } from '@fleet/sync-protocol';
let testDb: PgliteTestDb;
describe('PGLite smoke', () => {
  // No per-hook timeout override: PGLite WASM init takes ~10s isolated but
  // can exceed 30s under the coverage run (pool:forks + fileParallelism:false
  // in vitest.coverage.config.ts) and CI runner contention. A hardcoded
  // 30_000 here shadowed that config's hookTimeout:60_000 and caused a
  // non-deterministic CI failure. Inherit the 60s config budget.
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('loads migrations', async () => {
    const r = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM information_schema.tables WHERE table_schema = 'public'`);
    expect(Number(r.rows[0]?.count ?? 0)).toBeGreaterThan(5);
  });
  it('runs SyncService.processSync against real schema', async () => {
    const op = createOperatorContext();
    const svc = new SyncService(testDb.db as never);
    const res = await svc.processSync({ cursor: createSyncCursor('0'), actions: [] }, op);
    expect(res.status).toBe('ok');
  });
});
