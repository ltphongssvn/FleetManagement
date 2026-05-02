// apps/api/test/transport-orders.service.integration.test.ts
// PGLite integration: real schema, real 3 append paths, real road_run linkage.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let svc: TransportOrdersService;
const OP = createOperatorContext();

describe('@fleet/api - TransportOrdersService (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersService(testDb.db as never);
  }, 30_000);
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  beforeEach(async () => {
    await testDb.db.execute(sql`
      TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed,
        road_run_transport_order, road_run, stop, transport_order CASCADE
    `);
  });

  it('creates transport_order + stops with no road_run', async () => {
    const result = await svc.create({
      externalRef: 'TO-1',
      stops: [
        { sequence: 1, stopType: 'pickup' },
        { sequence: 2, stopType: 'dropoff' },
      ],
    }, OP);
    expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.roadRunId).toBeNull();

    const stopCount = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM stop`);
    expect(stopCount.rows[0]?.count).toBe('2');
  });

  it('creates road_run and writes 3 append paths', async () => {
    const result = await svc.create({
      externalRef: 'TO-2',
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { plannedStartAt: '2026-04-30T08:00:00.000Z' },
    }, OP);
    expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);

    const audit = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log WHERE event_type = 'road_run.created'`);
    const feed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed WHERE aggregate_type = 'road_run'`);
    const ob = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox WHERE queue_name = 'projections'`);
    expect(audit.rows[0]?.count).toBe('1');
    expect(feed.rows[0]?.count).toBe('1');
    expect(ob.rows[0]?.count).toBe('1');
  });

  it('isolates by company_id (no cross-tenant leak)', async () => {
    const op2 = createOperatorContext();
    await svc.create({ stops: [{ sequence: 1, stopType: 'pickup' }] }, OP);
    await svc.create({ stops: [{ sequence: 1, stopType: 'pickup' }] }, op2);
    const r = await testDb.db.execute<{ count: string }>(sql.raw(
      `SELECT COUNT(*)::text as count FROM transport_order WHERE company_id = '${OP.companyId}'`,
    ));
    expect(r.rows[0]?.count).toBe('1');
  });
});
