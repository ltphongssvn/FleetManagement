// apps/api/test/admin-device-binding.service.test.ts
// RED (device-binding arc, P5 slice-2e): admin binding lifecycle service.
// list returns company-scoped device rows; setBinding performs the TOFU
// transitions (activate: pending -> active; revoke: -> revoked, recording
// binding_revoked_at + reason, never deleting). PGlite real migrations.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { AdminDeviceBindingService } from '../src/admin/admin-device-binding.service.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
const COMPANY = '00000000-0000-0000-0000-000000000001';
const OTHER_COMPANY = '00000000-0000-0000-0000-0000000000ff';
describe('AdminDeviceBindingService (pglite)', () => {
  let testDb: PgliteTestDb;
  let service: AdminDeviceBindingService;
  let deviceId: string;
  async function seed(companyId: string, status: string, operatorId: string): Promise<string> {
    const r = await testDb.db.insert(deviceRegistry).values({
      companyId,
      businessUnitId: '00000000-0000-0000-0000-000000000002',
      depotId: '00000000-0000-0000-0000-000000000003',
      legalEntityId: '00000000-0000-0000-0000-000000000004',
      operatorId,
      platform: 'android',
      appVersion: '1.0.0',
      bindingStatus: status,
    }).returning({ deviceId: deviceRegistry.deviceId });
    const row = r[0]; if (row === undefined) throw new Error('seed failed');
    return row.deviceId;
  }
  beforeEach(async () => {
    testDb = await startPgliteTestDb();
    service = new AdminDeviceBindingService(testDb.db as never);
    deviceId = await seed(COMPANY, 'pending', '00000000-0000-0000-0000-0000000000a1');
  });
  afterEach(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('list returns only company-scoped rows', async () => {
    await seed(OTHER_COMPANY, 'active', '00000000-0000-0000-0000-0000000000b2');
    const rows = await service.list(COMPANY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceId).toBe(deviceId);
    expect(rows[0]?.bindingStatus).toBe('pending');
  });
  it('activate flips pending to active', async () => {
    await service.setBinding(COMPANY, deviceId, { action: 'activate' });
    const rows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    expect(rows[0]?.bindingStatus).toBe('active');
  });
  it('revoke records revoked status, timestamp, and reason', async () => {
    await service.setBinding(COMPANY, deviceId, { action: 'revoke', revokedReason: 'lost device' });
    const rows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    expect(rows[0]?.bindingStatus).toBe('revoked');
    expect(rows[0]?.bindingRevokedReason).toBe('lost device');
    expect(rows[0]?.bindingRevokedAt).toBeInstanceOf(Date);
  });
  it('list serializes attestationVerifiedAt to an ISO string when set', async () => {
    const when = new Date();
    await testDb.db
      .update(deviceRegistry)
      .set({ attestationVerifiedAt: when, attestationSecurityLevel: 'strongbox', attestationEnvironment: 'production' })
      .where(eq(deviceRegistry.deviceId, deviceId));
    const rows = await service.list(COMPANY);
    expect(rows[0]?.attestationVerifiedAt).toBe(when.toISOString());
    expect(rows[0]?.attestationSecurityLevel).toBe('strongbox');
  });

  it('revoke without a reason stores null', async () => {
    await service.setBinding(COMPANY, deviceId, { action: 'revoke' });
    const rows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    expect(rows[0]?.bindingStatus).toBe('revoked');
    expect(rows[0]?.bindingRevokedReason).toBeNull();
  });

  it('setBinding on another company device throws not-found', async () => {
    const otherId = await seed(OTHER_COMPANY, 'pending', '00000000-0000-0000-0000-0000000000c3');
    await expect(service.setBinding(COMPANY, otherId, { action: 'activate' })).rejects.toThrow(/not found/i);
  });
});
