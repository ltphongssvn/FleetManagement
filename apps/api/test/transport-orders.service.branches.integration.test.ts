// apps/api/test/transport-orders.service.branches.integration.test.ts
// PGlite integration: exercises the optional-field branches of create() that
// remain after roadRun became mandatory. Specifically: no externalRef, no
// customerId, no metadata, no plannedStartAt, no stop yardId/plannedAt.
// roadRun (with assignedOperatorId + assignedAssetId) and the backing
// driver_vehicle_assignment row are now required for every order, so each
// test seeds them.
//
// 2026-Q2 invariant: TransportOrdersService.create() ALWAYS server-assigns
// external_ref via OrderNumberingService (XTT.MM-NNN). The 'null externalRef'
// branch no longer exists; the test verifies the server-assigned format.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePairForOp(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'BRANCH', operatorId: op.operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'BR-001' })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({
    ...tn, driverId: d.driverId, vehicleId: v.vehicleId,
  });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersService.create (optional-field branches)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('creates with roadRun but every other optional field omitted (falsy ternary side)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePairForOp(tx, op);
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
      const auditSql = 'SELECT COUNT(*)::text as count FROM fleet_audit_log WHERE event_type = '
        + String.fromCharCode(39) + 'road_run.created' + String.fromCharCode(39);
      const audit = await tx.execute<{ count: string }>(sql.raw(auditSql));
      expect(audit.rows[0]?.count).toBe('1');
    });
  });
  it('listAssigned returns the server-assigned externalRef in XTT.MM-NNN form (pad-3+ suffix)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePairForOp(tx, op);
      await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const result = await svc.listAssigned(op);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.externalRef).toMatch(/^XTT\.[0-9]{2}-[0-9]{3,}$/);
      expect(result.rows[0]?.plannedStartAt).toBeNull();
    });
  });
});
