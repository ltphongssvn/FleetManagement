// apps/api/test/admin-device-enroll.service.test.ts
// RED: AdminDeviceEnrollService.enroll. PGlite-backed. Covers driver-not-found,
// operatorId-null, first-enrollment insert, conflicting re-enrollment update.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AdminDeviceEnrollService } from '../src/admin/admin-device-enroll.service.js';
import { driver } from '../src/database/schema/reference.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000000';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

describe('@fleet/api - AdminDeviceEnrollService', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_admindevenroll'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename!='__drizzle_migrations')
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  function svc(): AdminDeviceEnrollService {
    return new AdminDeviceEnrollService(testDb.db as never);
  }

  it('throws when the driver does not exist', async () => {
    await expect(svc().enroll({ driverId: randomUUID(), udid: 'u1', platform: 'android', companyId: COMPANY }))
      .rejects.toThrow(/driver not found/i);
  });

  it('throws when the driver has no operatorId', async () => {
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'NO OP' })
      .returning({ driverId: driver.driverId });
    if (d === undefined) throw new Error('seed failed');
    await expect(svc().enroll({ driverId: d.driverId, udid: 'u1', platform: 'android', companyId: COMPANY }))
      .rejects.toThrow(/no operatorId/i);
  }, 30_000);

  it('inserts a device_registry row on first enrollment', async () => {
    const operatorId = randomUUID();
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'HAS OP', operatorId })
      .returning({ driverId: driver.driverId });
    if (d === undefined) throw new Error('seed failed');
    const row = await svc().enroll({ driverId: d.driverId, udid: 'udid-1', platform: 'ios', companyId: COMPANY });
    expect(row.operatorId).toBe(operatorId);
    expect(row.udid).toBe('udid-1');
  }, 30_000);

  it('updates udid on conflicting (operatorId, platform) re-enrollment', async () => {
    const operatorId = randomUUID();
    const [d] = await testDb.db.insert(driver)
      .values({ ...TENANCY, fullName: 'REENROLL', operatorId })
      .returning({ driverId: driver.driverId });
    if (d === undefined) throw new Error('seed failed');
    await svc().enroll({ driverId: d.driverId, udid: 'udid-old', platform: 'ios', companyId: COMPANY });
    const updated = await svc().enroll({ driverId: d.driverId, udid: 'udid-new', platform: 'ios', companyId: COMPANY });
    expect(updated.udid).toBe('udid-new');
    const all = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.operatorId, operatorId));
    expect(all).toHaveLength(1);
  }, 30_000);
});
