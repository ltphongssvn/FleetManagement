// apps/api/test/reference.delete-revokes-assignment.integration.test.ts
// L3 invariant (2026-Q2 defense-in-depth): when a vehicle or driver is
// soft-deleted, every active driver_vehicle_assignment row referencing
// that entity MUST be revoked in the same transaction. Without this
// invariant, an E2E test (or any caller) that soft-deletes the entity
// without first revoking the assignment leaves the JOIN-based paired-only
// filter still returning the entity as 'paired and active', which leaks
// test data into the dispatcher reference dropdown.
//
// Business invariant being defended: driver and truck must be ACTIVELY
// assigned together — meaning the assignment row AND both endpoints must
// all be live. Soft-deleting an endpoint without revoking is a contract
// violation that this test makes structurally impossible from the API.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ReferenceService } from '../src/reference/reference.service.js';
import { AdminDriversUpdateService } from '../src/admin/admin-drivers-update.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
function tenancy(): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
  };
}
async function seedPair(tx: TestTx, suffix: string): Promise<{ driverId: string; vehicleId: string; assignmentId: string }> {
  const tn = tenancy();
  const operatorId = randomUUID();
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'DEL-' + suffix, operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'DEL-' + suffix }).returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  const [a] = await tx.insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId })
    .returning({ assignmentId: driverVehicleAssignment.assignmentId });
  if (!a) throw new Error('assignment seed failed');
  return { driverId: d.driverId, vehicleId: v.vehicleId, assignmentId: a.assignmentId };
}
describe('@fleet/api - soft-delete cascades revocation onto active driver_vehicle_assignment', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('deleteVehicle() revokes the active assignment referencing that vehicle', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const pair = await seedPair(tx, 'V');
      const svc = new ReferenceService(tx as never);
      await svc.deleteVehicle(OP, pair.vehicleId);
      const [row] = await tx.select({ revokedAt: driverVehicleAssignment.revokedAt })
        .from(driverVehicleAssignment)
        .where(and(eq(driverVehicleAssignment.companyId, OP.companyId), eq(driverVehicleAssignment.assignmentId, pair.assignmentId)));
      return row?.revokedAt ?? null;
    });
    expect(captured).not.toBeNull();
  });
  it('AdminDriversUpdateService.softDelete() revokes the active assignment referencing that driver', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const pair = await seedPair(tx, 'D');
      const svc = new AdminDriversUpdateService(tx as never);
      await svc.softDelete({ companyId: OP.companyId, driverId: pair.driverId });
      const [row] = await tx.select({ revokedAt: driverVehicleAssignment.revokedAt })
        .from(driverVehicleAssignment)
        .where(and(eq(driverVehicleAssignment.companyId, OP.companyId), eq(driverVehicleAssignment.assignmentId, pair.assignmentId)));
      return row?.revokedAt ?? null;
    });
    expect(captured).not.toBeNull();
  });
});
