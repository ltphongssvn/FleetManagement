// apps/api/test/with-tx-isolation.error-propagation.test.ts
// T5b RED (helper fix): withTxIsolation MUST propagate ANY error thrown
// inside body that is NOT drizzle's internal RollbackError. Today it
// swallows every error via .catch(()=>{}), which silently masks failed
// assertions and unique-violation rejections — a latent test-infra bug.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
let testDb: PgliteTestDb;
describe('withTxIsolation error propagation', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('propagates a generic Error thrown in body', async () => {
    await expect(withTxIsolation(testDb, () => {
      throw new Error('boom-from-body');
    })).rejects.toThrow(/boom-from-body/);
  });
  it('propagates an AssertionError-shaped error thrown in body', async () => {
    class AssertionLike extends Error { constructor(msg: string) { super(msg); this.name = 'AssertionError'; } }
    await expect(withTxIsolation(testDb, () => {
      throw new AssertionLike('assertion-from-body');
    })).rejects.toThrow(/assertion-from-body/);
  });
  it('still rolls back cleanly when body completes normally (no error surfaces)', async () => {
    const result = await withTxIsolation(testDb, () => 'ok-value');
    expect(result).toBe('ok-value');
  });
});
