// apps/api/test/transport-orders.service.branches.integration.test.ts
// PGLite integration: exercises the falsy side of every optional-field
// ternary in create() — no externalRef, no customerId, no metadata,
// roadRun present but with no optional fields (assignedOperatorId,
// assignedAssetId, plannedStartAt all undefined), and a stop with no
// yardId/plannedAt. Pins branch coverage on transport-orders.service.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let svc: TransportOrdersService;

describe('@fleet/api - TransportOrdersService.create (optional-field branches)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersService(testDb.db as never);
  }, 30_000);

  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  beforeEach(async () => {
    await testDb.db.execute(sql.raw(
      'TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed, ' +
      'road_run_transport_order, road_run, stop, transport_order CASCADE',
    ));
  });

  it('creates with road_run but every optional field omitted (falsy ternary side)', async () => {
    const op = createOperatorContext();
    const result = await svc.create({
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: {},
    }, op);

    expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);

    const auditSql = "SELECT COUNT(*)::text as count FROM fleet_audit_log " +
      "WHERE event_type = 'road_run.created'";
    const audit = await testDb.db.execute<{ count: string }>(sql.raw(auditSql));
    expect(audit.rows[0]?.count).toBe('1');
  });

  it('listAssigned returns null externalRef when transport_order has none', async () => {
    const op = createOperatorContext();
    await svc.create({
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: op.operatorId },
    }, op);

    const result = await svc.listAssigned(op);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.externalRef).toBeNull();
    expect(result.rows[0]?.plannedStartAt).toBeNull();
  });
});
