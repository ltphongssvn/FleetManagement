// apps/api/test/device-enrollment.service.test.ts
// RED: DeviceEnrollmentService.enroll covers insert + onConflictDoUpdate paths.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DeviceEnrollmentService } from '../src/device/device-enrollment.service.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const TENANCY = {
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

describe('@fleet/api - DeviceEnrollmentService', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_devenroll'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  function svc(): DeviceEnrollmentService {
    return new DeviceEnrollmentService(testDb.db as never);
  }

  it('inserts a new device_registry row on first enrollment', async () => {
    const operatorId = randomUUID();
    const row = await svc().enroll({
      ...TENANCY, operatorId, platform: 'android', appVersion: '1.0.0',
    });
    expect(row.operatorId).toBe(operatorId);
    expect(row.appVersion).toBe('1.0.0');
    const all = await testDb.db.select().from(deviceRegistry)
      .where(eq(deviceRegistry.operatorId, operatorId));
    expect(all).toHaveLength(1);
  }, 30_000);

  it('updates appVersion + expoPushToken on conflicting (operatorId, platform) re-enrollment', async () => {
    const operatorId = randomUUID();
    await svc().enroll({ ...TENANCY, operatorId, platform: 'ios', appVersion: '1.0.0' });
    const updated = await svc().enroll({
      ...TENANCY, operatorId, platform: 'ios', appVersion: '2.0.0',
      expoPushToken: 'ExponentPushToken[abc]',
    });
    expect(updated.appVersion).toBe('2.0.0');
    expect(updated.expoPushToken).toBe('ExponentPushToken[abc]');
    const all = await testDb.db.select().from(deviceRegistry)
      .where(eq(deviceRegistry.operatorId, operatorId));
    expect(all).toHaveLength(1);
  }, 30_000);
});
