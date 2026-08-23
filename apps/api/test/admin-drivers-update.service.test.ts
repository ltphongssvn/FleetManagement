// apps/api/test/admin-drivers-update.service.test.ts
// RED→GREEN: AdminDriversUpdateService. PGlite-backed integration tests
// validate update (rename + optional phone) and softDelete (active=false),
// both scoped by companyId so a foreign-tenant id cannot mutate this tenant's rows.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { AdminDriversUpdateService } from '../src/admin/admin-drivers-update.service.js';
import { driver } from '../src/database/schema/reference.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
  truncateAllTables,
} from './helpers/migrate-test-db.js';
let testDb: MigratedTestDb;
const COMPANY = '11111111-1111-1111-1111-111111111111';
const OTHER_COMPANY = '99999999-9999-9999-9999-999999999999';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '22222222-2222-2222-2222-222222222222',
  depotId: '33333333-3333-3333-3333-333333333333',
  legalEntityId: '44444444-4444-4444-4444-444444444444',
};
const OTHER_TENANCY = {
  companyId: OTHER_COMPANY,
  businessUnitId: '88888888-8888-8888-8888-888888888888',
  depotId: '77777777-7777-7777-7777-777777777777',
  legalEntityId: '66666666-6666-6666-6666-666666666666',
};
describe('@fleet/api - AdminDriversUpdateService', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test_adminupd');
  });
  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });
  function svc(): AdminDriversUpdateService {
    return new AdminDriversUpdateService(testDb.db as never);
  }
  async function seedDriver(
    tenancy: typeof TENANCY,
    fullName: string,
    phone?: string,
  ): Promise<string> {
    const [row] = await testDb.db
      .insert(driver)
      .values({ ...tenancy, fullName, phone })
      .returning({ driverId: driver.driverId });
    if (row === undefined) throw new Error('seed failed');
    return row.driverId;
  }
  it('update renames the driver in place', async () => {
    const id = await seedDriver(TENANCY, 'OLD NAME', '+84900000001');
    await svc().update({ driverId: id, companyId: COMPANY, fullName: 'NEW NAME' });
    const [row] = await testDb.db.select().from(driver).where(eq(driver.driverId, id));
    expect(row?.fullName).toBe('NEW NAME');
    expect(row?.phone).toBe('+84900000001');
    expect(row?.active).toBe(true);
  });
  it('update applies phone when provided', async () => {
    const id = await seedDriver(TENANCY, 'A', '+84900000001');
    await svc().update({ driverId: id, companyId: COMPANY, fullName: 'A', phone: '+84999999999' });
    const [row] = await testDb.db.select().from(driver).where(eq(driver.driverId, id));
    expect(row?.phone).toBe('+84999999999');
  }, 30_000);
  it('update is a no-op when companyId does not match (cross-tenant guard)', async () => {
    const id = await seedDriver(TENANCY, 'KEEP', '+84900000001');
    await svc().update({ driverId: id, companyId: OTHER_COMPANY, fullName: 'HACKED' });
    const [row] = await testDb.db.select().from(driver).where(eq(driver.driverId, id));
    expect(row?.fullName).toBe('KEEP');
  }, 30_000);
  it('softDelete flips active=false', async () => {
    const id = await seedDriver(TENANCY, 'BYE', '+84900000001');
    await svc().softDelete({ driverId: id, companyId: COMPANY });
    const [row] = await testDb.db
      .select()
      .from(driver)
      .where(and(eq(driver.driverId, id), eq(driver.companyId, COMPANY)));
    expect(row?.active).toBe(false);
    expect(row?.fullName).toBe('BYE');
  }, 30_000);
  it('softDelete is a no-op when companyId does not match', async () => {
    const id = await seedDriver(TENANCY, 'KEEP', '+84900000001');
    await svc().softDelete({ driverId: id, companyId: OTHER_COMPANY });
    const [row] = await testDb.db.select().from(driver).where(eq(driver.driverId, id));
    expect(row?.active).toBe(true);
  }, 30_000);
  it('update of one driver does not touch another tenant row with same name', async () => {
    const a = await seedDriver(TENANCY, 'SHARED NAME', '+84900000001');
    const b = await seedDriver(OTHER_TENANCY, 'SHARED NAME', '+84900000002');
    await svc().update({ driverId: a, companyId: COMPANY, fullName: 'CHANGED' });
    const [rowA] = await testDb.db.select().from(driver).where(eq(driver.driverId, a));
    const [rowB] = await testDb.db.select().from(driver).where(eq(driver.driverId, b));
    expect(rowA?.fullName).toBe('CHANGED');
    expect(rowB?.fullName).toBe('SHARED NAME');
  }, 30_000);
});
