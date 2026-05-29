// apps/api/test/transport-orders.service.integration.test.ts
// PGlite integration: real schema, real 3 append paths, real road_run linkage.
// 2026: every order requires a roadRun + active driver-vehicle pair, so each
// test seeds the pair before calling svc.create.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// Post-create COUNT queries go through tx because the inserted rows live
// inside the SAVEPOINT created by the SUT and are invisible to testDb.db.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{
  operatorId: string; vehicleId: string;
}> {
  const operatorId = randomUUID();
  const tn = {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'INT', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'INT-' + operatorId.slice(0,4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({
    ...tn, driverId: d.driverId, vehicleId: v.vehicleId,
  });
  return { operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersService (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('creates transport_order + stops + road_run for a paired driver/truck', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx, OP);
      const result = await svc.create({
        externalRef: 'TO-1',
        stops: [
          { sequence: 1, stopType: 'pickup' },
          { sequence: 2, stopType: 'dropoff' },
        ],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, OP);
      expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
      const stopCount = await tx.execute<{ count: string }>(sql.raw('SELECT COUNT(*)::text as count FROM stop'));
      expect(stopCount.rows[0]?.count).toBe('2');
    });
  });
  it('creates road_run and writes 3 append paths', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx, OP);
      const result = await svc.create({
        externalRef: 'TO-2',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
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
      const a = await seedActivePair(tx, OP);
      const b = await seedActivePair(tx, op2);
      await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: a.operatorId, assignedAssetId: a.vehicleId },
      }, OP);
      await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: b.operatorId, assignedAssetId: b.vehicleId },
      }, op2);
      const qt = String.fromCharCode(39);
      const r = await tx.execute<{ count: string }>(sql.raw(
        'SELECT COUNT(*)::text as count FROM transport_order WHERE company_id = '
        + qt + OP.companyId + qt,
      ));
      expect(r.rows[0]?.count).toBe('1');
    });
  });
});
