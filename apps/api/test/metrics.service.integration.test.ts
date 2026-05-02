// apps/api/test/metrics.service.integration.test.ts
// PGLite-backed integration test. Replaces the mockDeep<FleetDb> chain mock
// in metrics.service.test.ts. Real schema, real outbox table, real COUNT().
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { MetricsService } from '../src/metrics/metrics.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';

let testDb: PgliteTestDb;
let svc: MetricsService;

const TENANCY_COLS = `
  company_id, business_unit_id, depot_id, legal_entity_id
`;
const TENANCY_VALS = `
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid
`;

async function insertOutboxRow(status: string): Promise<void> {
  await testDb.db.execute(sql.raw(`
    INSERT INTO outbox (${TENANCY_COLS}, queue_name, payload, status)
    VALUES (${TENANCY_VALS}, 'projections', '{}'::jsonb, '${status}')
  `));
}

describe('@fleet/api - MetricsService (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new MetricsService(testDb.db as never);
  }, 30_000);
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE outbox CASCADE`);
  });

  it('returns 0 when outbox empty', async () => {
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(0);
    expect(m.alerts).not.toContain('outbox_dlq_high');
  });

  it('counts only dead_letter status rows, ignores pending/sent/failed', async () => {
    for (let i = 0; i < 7; i++) await insertOutboxRow('dead_letter');
    await insertOutboxRow('pending');
    await insertOutboxRow('sent');
    await insertOutboxRow('failed');
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(7);
    expect(m.alerts).not.toContain('outbox_dlq_high');
  });

  it('raises outbox_dlq_high alert when depth >= 10', async () => {
    for (let i = 0; i < 12; i++) await insertOutboxRow('dead_letter');
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(12);
    expect(m.alerts).toContain('outbox_dlq_high');
  });

  it('does not raise alert when depth = 9 (boundary)', async () => {
    for (let i = 0; i < 9; i++) await insertOutboxRow('dead_letter');
    const m = await svc.snapshot();
    expect(m.alerts).not.toContain('outbox_dlq_high');
  });

  it('raises alert exactly at boundary depth = 10', async () => {
    for (let i = 0; i < 10; i++) await insertOutboxRow('dead_letter');
    const m = await svc.snapshot();
    expect(m.alerts).toContain('outbox_dlq_high');
  });
});
