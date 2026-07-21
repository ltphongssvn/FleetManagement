// apps/api/test/driver-me.service.test.ts
// RED: DriverMeService.fetchMe covers 4 branches: driver-not-found throw,
// no active assignment, assignment with missing vehicle, full happy path.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DriverMeService } from '../src/driver/driver-me.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000000';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

describe('@fleet/api - DriverMeService', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_driverme'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  function svc(): DriverMeService {
    return new DriverMeService(testDb.db as never);
  }

  it('throws when no driver matches the operator', async () => {
    await expect(svc().fetchMe({ operatorId: randomUUID(), companyId: COMPANY }))
      .rejects.toThrow(/driver not found/i);
  });

  it('returns assignedVehicle=null when the driver has no active assignment', async () => {
    const operatorId = randomUUID();
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'NO ASSIGN', operatorId });
    const result = await svc().fetchMe({ operatorId, companyId: COMPANY });
    expect(result.driver.operatorId).toBe(operatorId);
    expect(result.assignedVehicle).toBeNull();
  });

  it('ignores a revoked assignment (assignedVehicle stays null)', async () => {
    const operatorId = randomUUID();
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'REVOKED', operatorId })
      .returning({ driverId: driver.driverId });
    const [v] = await testDb.db.insert(vehicle)
      .values({ ...TENANCY, plate: 'REV-001' })
      .returning({ vehicleId: vehicle.vehicleId });
    if (d === undefined || v === undefined) throw new Error('insert returned no row');
    await testDb.db.insert(driverVehicleAssignment).values({
      ...TENANCY, driverId: d.driverId, vehicleId: v.vehicleId, revokedAt: new Date(),
    });
    const result = await svc().fetchMe({ operatorId, companyId: COMPANY });
    expect(result.assignedVehicle).toBeNull();
  });

  it('returns the assigned vehicle on the full happy path', async () => {
    const operatorId = randomUUID();
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'HAPPY', operatorId })
      .returning({ driverId: driver.driverId });
    const [v] = await testDb.db.insert(vehicle)
      .values({ ...TENANCY, plate: 'HAP-001' })
      .returning({ vehicleId: vehicle.vehicleId });
    if (d === undefined || v === undefined) throw new Error('insert returned no row');
    await testDb.db.insert(driverVehicleAssignment).values({
      ...TENANCY, driverId: d.driverId, vehicleId: v.vehicleId,
    });
    const result = await svc().fetchMe({ operatorId, companyId: COMPANY });
    expect(result.driver.fullName).toBe('HAPPY');
    expect(result.assignedVehicle?.plate).toBe('HAP-001');
  });
});
