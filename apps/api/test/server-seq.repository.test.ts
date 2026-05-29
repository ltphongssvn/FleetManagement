// apps/api/test/server-seq.repository.test.ts
// RED test for shared allocateServerSeq helper (DRY extraction).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { allocateServerSeq } from '../src/database/server-seq.repository.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;

describe('@fleet/api - allocateServerSeq', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_seq'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`SELECT setval('fleet_server_seq', 1, false)`);
  });

  it('returns monotonically increasing bigint values inside a tx', async () => {
    const seqs = await testDb.db.transaction(async (tx) => {
      const a = await allocateServerSeq(tx);
      const b = await allocateServerSeq(tx);
      return [a, b];
    });
    const [a, b] = seqs;
    if (a === undefined || b === undefined) throw new Error('expected two seqs');
    expect(typeof a).toBe('bigint');
    expect(b).toBeGreaterThan(a);
  });

  it('produces N distinct values under N concurrent transactions', async () => {
    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        testDb.db.transaction(async (tx) => allocateServerSeq(tx)),
      ),
    );
    const distinct = new Set(results.map(String));
    expect(distinct.size).toBe(N);
  }, 30_000);
});
