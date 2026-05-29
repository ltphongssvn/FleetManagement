// apps/api/test/admin-drivers-list.service.test.ts
// RED: AdminDriversListService.list. PGlite-backed. Covers empty result,
// driver with active assignment+vehicle, driver with no assignment,
// operatorId null vs set (devices fetch branch), and soft-deleted exclusion.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminDriversListService } from '../src/admin/admin-drivers-list.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000000';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};
describe('@fleet/api - AdminDriversListService', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_adminlist'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });
  function svc(): AdminDriversListService {
    return new AdminDriversListService(testDb.db as never);
  }
  it('returns an empty array when the company has no drivers', async () => {
    expect(await svc().list({ companyId: COMPANY })).toEqual([]);
  });
  it('lists a driver with no assignment and no operatorId (devices empty)', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'NO OP' });
    const rows = await svc().list({ companyId: COMPANY });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assignedVehicle).toBeNull();
    expect(rows[0]?.assignmentId).toBeNull();
    expect(rows[0]?.operatorId).toBeNull();
    expect(rows[0]?.devices).toEqual([]);
  }, 30_000);
  it('lists a driver with an active assignment, vehicle, operatorId and a device', async () => {
    const operatorId = randomUUID();
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'FULL', operatorId })
      .returning({ driverId: driver.driverId });
    const [v] = await testDb.db.insert(vehicle)
      .values({ ...TENANCY, plate: 'LIST-001' })
      .returning({ vehicleId: vehicle.vehicleId });
    if (d === undefined || v === undefined) throw new Error('seed failed');
    await testDb.db.insert(driverVehicleAssignment)
      .values({ ...TENANCY, driverId: d.driverId, vehicleId: v.vehicleId });
    await testDb.db.insert(deviceRegistry)
      .values({ ...TENANCY, operatorId, platform: 'android', appVersion: '1.0.0' });
    const rows = await svc().list({ companyId: COMPANY });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assignedVehicle?.plate).toBe('LIST-001');
    expect(rows[0]?.assignmentId).not.toBeNull();
    expect(rows[0]?.devices).toHaveLength(1);
  }, 30_000);
  it('excludes soft-deleted (active=false) drivers from the list', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'ACTIVE ONE', active: true });
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'SOFT DELETED', active: false });
    const rows = await svc().list({ companyId: COMPANY });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe('ACTIVE ONE');
    expect(rows.some((r) => r.fullName === 'SOFT DELETED')).toBe(false);
  }, 30_000);
});
