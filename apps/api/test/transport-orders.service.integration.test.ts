// apps/api/test/transport-orders.service.integration.test.ts
// PGlite integration: real schema, real 3 append paths, real road_run linkage.
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// Post-create COUNT queries go through tx because the inserted rows live
// inside the SAVEPOINT created by the SUT and are invisible to testDb.db.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
describe('@fleet/api - TransportOrdersService (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('creates transport_order + stops with no road_run', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const result = await svc.create({
        externalRef: 'TO-1',
        stops: [
          { sequence: 1, stopType: 'pickup' },
          { sequence: 2, stopType: 'dropoff' },
        ],
      }, OP);
      expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.roadRunId).toBeNull();
      const stopCount = await tx.execute<{ count: string }>(sql.raw('SELECT COUNT(*)::text as count FROM stop'));
      expect(stopCount.rows[0]?.count).toBe('2');
    });
  });
  it('creates road_run and writes 3 append paths', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const result = await svc.create({
        externalRef: 'TO-2',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-04-30T08:00:00.000Z' },
      }, OP);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
      const qt = String.fromCharCode(39);
      const auditSql = 'SELECT COUNT(*)::text as count FROM fleet_audit_log WHERE event_type = '
        + qt + 'road_run.created' + qt;
      const feedSql = 'SELECT COUNT(*)::text as count FROM sync_change_feed WHERE aggregate_type = '
        + qt + 'road_run' + qt;
      const obSql = 'SELECT COUNT(*)::text as count FROM outbox WHERE queue_name = '
        + qt + 'projections' + qt;
      const audit = await tx.execute<{ count: string }>(sql.raw(auditSql));
      const feed = await tx.execute<{ count: string }>(sql.raw(feedSql));
      const ob = await tx.execute<{ count: string }>(sql.raw(obSql));
      expect(audit.rows[0]?.count).toBe('1');
      expect(feed.rows[0]?.count).toBe('1');
      expect(ob.rows[0]?.count).toBe('1');
    });
  });
  it('isolates by company_id (no cross-tenant leak)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op2 = createOperatorContext();
      await svc.create({ stops: [{ sequence: 1, stopType: 'pickup' }] }, OP);
      await svc.create({ stops: [{ sequence: 1, stopType: 'pickup' }] }, op2);
      const qt = String.fromCharCode(39);
      const r = await tx.execute<{ count: string }>(sql.raw(
        'SELECT COUNT(*)::text as count FROM transport_order WHERE company_id = '
        + qt + OP.companyId + qt,
      ));
      expect(r.rows[0]?.count).toBe('1');
    });
  });
});
