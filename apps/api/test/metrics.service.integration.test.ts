// apps/api/test/metrics.service.integration.test.ts
// PGlite-backed integration test for MetricsService.snapshot() — counts
// outbox dead-letter rows and raises an alert when >= 10.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// MetricsService.snapshot is a single SELECT, so SAVEPOINT nesting is
// irrelevant; tx-injection here is purely for state isolation/speed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MetricsService } from '../src/metrics/metrics.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
let testDb: PgliteTestDb;
const qt = String.fromCharCode(39);
const TENANCY_COLS = 'company_id, business_unit_id, depot_id, legal_entity_id';
const TENANCY_VALS =
  qt + '00000000-0000-0000-0000-000000000001' + qt + '::uuid, ' +
  qt + '00000000-0000-0000-0000-000000000002' + qt + '::uuid, ' +
  qt + '00000000-0000-0000-0000-000000000003' + qt + '::uuid, ' +
  qt + '00000000-0000-0000-0000-000000000004' + qt + '::uuid';
async function insertOutboxRow(tx: TestTx, status: string): Promise<void> {
  const stmt = 'INSERT INTO outbox (' + TENANCY_COLS + ', queue_name, payload, status) VALUES ('
    + TENANCY_VALS + ', '
    + qt + 'projections' + qt + ', '
    + qt + '{}' + qt + '::jsonb, '
    + qt + status + qt + ')';
  await tx.execute(sql.raw(stmt));
}
describe('@fleet/api - MetricsService (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns 0 when outbox empty', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new MetricsService(tx as never);
      const m = await svc.snapshot();
      expect(m.outboxDeadLetterDepth).toBe(0);
      expect(m.alerts).not.toContain('outbox_dlq_high');
    });
  });
  it('counts only dead_letter status rows, ignores pending/sent/failed', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new MetricsService(tx as never);
      for (let i = 0; i < 7; i++) await insertOutboxRow(tx, 'dead_letter');
      await insertOutboxRow(tx, 'pending');
      await insertOutboxRow(tx, 'sent');
      await insertOutboxRow(tx, 'failed');
      const m = await svc.snapshot();
      expect(m.outboxDeadLetterDepth).toBe(7);
      expect(m.alerts).not.toContain('outbox_dlq_high');
    });
  });
  it('raises outbox_dlq_high alert when depth >= 10', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new MetricsService(tx as never);
      for (let i = 0; i < 12; i++) await insertOutboxRow(tx, 'dead_letter');
      const m = await svc.snapshot();
      expect(m.outboxDeadLetterDepth).toBe(12);
      expect(m.alerts).toContain('outbox_dlq_high');
    });
  });
  it('does not raise alert when depth = 9 (boundary)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new MetricsService(tx as never);
      for (let i = 0; i < 9; i++) await insertOutboxRow(tx, 'dead_letter');
      const m = await svc.snapshot();
      expect(m.alerts).not.toContain('outbox_dlq_high');
    });
  });
  it('raises alert exactly at boundary depth = 10', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new MetricsService(tx as never);
      for (let i = 0; i < 10; i++) await insertOutboxRow(tx, 'dead_letter');
      const m = await svc.snapshot();
      expect(m.alerts).toContain('outbox_dlq_high');
    });
  });
});
