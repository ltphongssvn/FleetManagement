// apps/api/test/admin-assignment.service.test.ts
// RED: AdminAssignmentService.assign + revoke. PGlite-backed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminAssignmentService } from '../src/admin/admin-assignment.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const TENANCY = {
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

async function seedDriverVehicle(): Promise<{ driverId: string; vehicleId: string }> {
  const [d] = await testDb.db.insert(driver)
    .values({ ...TENANCY, fullName: 'D-' + randomUUID().slice(0, 8) })
    .returning({ driverId: driver.driverId });
  const [v] = await testDb.db.insert(vehicle)
    .values({ ...TENANCY, plate: 'P-' + randomUUID().slice(0, 8) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  return { driverId: d.driverId, vehicleId: v.vehicleId };
}

describe('@fleet/api - AdminAssignmentService', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_adminassign'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  function svc(): AdminAssignmentService {
    return new AdminAssignmentService(testDb.db as never);
  }

  it('assign() inserts a driver-vehicle assignment row', async () => {
    const { driverId, vehicleId } = await seedDriverVehicle();
    const row = await svc().assign({ ...TENANCY, driverId, vehicleId });
    expect(row.driverId).toBe(driverId);
    expect(row.vehicleId).toBe(vehicleId);
    expect(row.revokedAt).toBeNull();
  }, 30_000);

  it('revoke() soft-revokes an active assignment with a reason', async () => {
    const { driverId, vehicleId } = await seedDriverVehicle();
    const created = await svc().assign({ ...TENANCY, driverId, vehicleId });
    const revoked = await svc().revoke({ assignmentId: created.assignmentId, reason: 'reassigned' });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revocationReason).toBe('reassigned');
  }, 30_000);

  it('revoke() throws when the assignment does not exist', async () => {
    await expect(svc().revoke({ assignmentId: randomUUID(), reason: 'x' }))
      .rejects.toThrow(/not found or already revoked/i);
  });

  it('revoke() throws when the assignment is already revoked', async () => {
    const { driverId, vehicleId } = await seedDriverVehicle();
    const created = await svc().assign({ ...TENANCY, driverId, vehicleId });
    await svc().revoke({ assignmentId: created.assignmentId, reason: 'first' });
    await expect(svc().revoke({ assignmentId: created.assignmentId, reason: 'second' }))
      .rejects.toThrow(/not found or already revoked/i);
  }, 30_000);
});
