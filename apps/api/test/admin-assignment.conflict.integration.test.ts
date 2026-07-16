// apps/api/test/admin-assignment.conflict.integration.test.ts
// RED-first: a second ACTIVE assignment for the same driver (or the same
// vehicle) must surface as a 409 ConflictException with a localized Vietnamese
// message, NOT a raw 500. The DB partial-unique indexes already PREVENT the
// duplicate (verified valid in prod); this pins graceful CODE handling of the
// 23505 the index throws (isPgUniqueViolationOnConstraintInChain -> 409).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
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

async function seedDriver(): Promise<string> {
  const [d] = await testDb.db.insert(driver)
    .values({ ...TENANCY, fullName: 'D-' + randomUUID().slice(0, 8) })
    .returning({ driverId: driver.driverId });
  if (d === undefined) throw new Error('seed driver failed');
  return d.driverId;
}
async function seedVehicle(): Promise<string> {
  const [v] = await testDb.db.insert(vehicle)
    .values({ ...TENANCY, plate: 'P-' + randomUUID().slice(0, 8) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (v === undefined) throw new Error('seed vehicle failed');
  return v.vehicleId;
}

describe('@fleet/api - AdminAssignmentService conflict (409)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_adminassign_conflict'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await truncateAllTables(testDb.db); });
  function svc(): AdminAssignmentService { return new AdminAssignmentService(testDb.db as never); }

  it('throws ConflictException when the same driver is assigned a second active vehicle', async () => {
    const driverId = await seedDriver();
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    await svc().assign({ ...TENANCY, driverId, vehicleId: v1 });
    await expect(svc().assign({ ...TENANCY, driverId, vehicleId: v2 }))
      .rejects.toBeInstanceOf(ConflictException);
  }, 30_000);

  it('throws ConflictException when the same vehicle is assigned a second active driver', async () => {
    const vehicleId = await seedVehicle();
    const d1 = await seedDriver();
    const d2 = await seedDriver();
    await svc().assign({ ...TENANCY, driverId: d1, vehicleId });
    await expect(svc().assign({ ...TENANCY, driverId: d2, vehicleId }))
      .rejects.toBeInstanceOf(ConflictException);
  }, 30_000);

  it('allows re-assigning the same driver after the prior assignment is revoked', async () => {
    const driverId = await seedDriver();
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const first = await svc().assign({ ...TENANCY, driverId, vehicleId: v1 });
    await svc().revoke({ assignmentId: first.assignmentId, reason: 'reassign' });
    const second = await svc().assign({ ...TENANCY, driverId, vehicleId: v2 });
    expect(second.vehicleId).toBe(v2);
    expect(second.revokedAt).toBeNull();
  }, 30_000);
});
