// apps/api/test/device.service.integration.test.ts
// Integration tests with real Postgres via Testcontainers.
// Schema applied via real drizzle migrations through migrate-test-db helper.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConflictException } from '@nestjs/common';
import { DeviceService } from '../src/device/device.service.js';
import type * as schema from '../src/database/schema/index.js';
import {
  TEST_TENANT,
  TEST_DEVICE_ID,
  TEST_OPERATOR_ID,
  makeIssueInput,
} from './fixtures/device.fixtures.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
  truncateAllTables,
} from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
let service: DeviceService;

async function seedDevice(
  d: NodePgDatabase<typeof schema>,
  deviceId: string,
  operatorId: string,
): Promise<void> {
  await d.execute(sql`
    INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
    VALUES (${deviceId}::uuid, ${TEST_TENANT.companyId}::uuid, ${TEST_TENANT.businessUnitId}::uuid, ${TEST_TENANT.depotId}::uuid, ${TEST_TENANT.legalEntityId}::uuid, ${operatorId}::uuid, 'ios', '0.1.0')
  `);
}

describe('@fleet/api - DeviceService (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new DeviceService(testDb.db);
  });

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  describe('issueSession', () => {
    it('issues a mutating session against real Postgres', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const result = await service.issueSession(makeIssueInput());
      expect(result.surface).toBe('road');
      expect(result.revokedAt).toBeNull();
    });

    it('rejects second concurrent mutating session via DB unique constraint', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput();
      const results = await Promise.allSettled([
        service.issueSession(input),
        service.issueSession(input),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const failure = rejected[0];
      if (failure?.status !== 'rejected') throw new Error('expected rejection');
      expect(failure.reason).toBeInstanceOf(ConflictException);
    });

    it('allows new mutating session after previous is revoked', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput();
      const first = await service.issueSession(input);
      await service.revokeSession(first.deviceSessionId, 'admin_revoke');
      const second = await service.issueSession(input);
      expect(second.deviceSessionId).not.toBe(first.deviceSessionId);
    });

    it('rejects issueSession with unregistered deviceId via FK violation', async () => {
      await expect(service.issueSession(makeIssueInput())).rejects.toThrow();
    });

    it('allows multiple shadow sessions for same operator+surface', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput({ sessionMode: 'shadow' });
      await service.issueSession(input);
      await expect(service.issueSession(input)).resolves.toBeDefined();
    });
  });

  describe('revokeSession', () => {
    it('is idempotent against real DB', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      const first = await service.revokeSession(issued.deviceSessionId, 'admin_revoke');
      const second = await service.revokeSession(issued.deviceSessionId, 'shift_end');
      expect(first.revocationReason).toBe('admin_revoke');
      expect(second.revocationReason).toBe('admin_revoke');
    });
  });

  describe('findActiveSession', () => {
    it('returns the row when an active session exists', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      const found = await service.findActiveSession(issued.deviceSessionId);
      expect(found?.deviceSessionId).toBe(issued.deviceSessionId);
    });

    it('returns null after the session is revoked', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      await service.revokeSession(issued.deviceSessionId, 'admin_revoke');
      expect(await service.findActiveSession(issued.deviceSessionId)).toBeNull();
    });
  });

  describe('deviceExists', () => {
    it('returns true for registered devices', async () => {
      await seedDevice(testDb.db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      expect(await service.deviceExists(TEST_DEVICE_ID)).toBe(true);
    });

    it('returns false for unknown devices', async () => {
      expect(await service.deviceExists('00000000-0000-0000-0000-0000000000ff')).toBe(false);
    });
  });
});
