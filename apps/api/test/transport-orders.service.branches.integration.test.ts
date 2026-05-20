// apps/api/test/transport-orders.service.branches.integration.test.ts
// PGLite integration: exercises the falsy side of every optional-field
// ternary in create() — no externalRef, no customerId, no metadata,
// roadRun present but with no optional fields (assignedOperatorId,
// assignedAssetId, plannedStartAt all undefined), and a stop with no
// yardId/plannedAt. Pins branch coverage on transport-orders.service.ts.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// Reads (e.g. SELECT against fleet_audit_log) MUST go through tx
// because the audit row exists inside the SAVEPOINT created by the SUT;
// a read via testDb.db would not see it until commit (which never happens).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - TransportOrdersService.create (optional-field branches)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('creates with road_run but every optional field omitted (falsy ternary side)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {},
      }, op);
      expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
      const auditSql = 'SELECT COUNT(*)::text as count FROM fleet_audit_log '
        + 'WHERE event_type = ' + String.fromCharCode(39) + 'road_run.created' + String.fromCharCode(39);
      const audit = await tx.execute<{ count: string }>(sql.raw(auditSql));
      expect(audit.rows[0]?.count).toBe('1');
    });
  });
  it('listAssigned returns null externalRef when transport_order has none', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
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
});
