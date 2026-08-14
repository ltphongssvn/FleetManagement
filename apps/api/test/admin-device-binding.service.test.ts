// apps/api/test/admin-device-binding.service.test.ts
// device-binding arc, P7 slice-A: list evolves to a FILTERED, offset-paginated
// query returning the SSOT AdminDeviceListResponse envelope (data + page meta +
// total + hasMore). setBinding still performs the TOFU transitions. PGlite real
// migrations. Ordering is (enrolledAt, deviceId) so pagination is deterministic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AdminDeviceListResponseSchema,
  ADMIN_DEVICE_PAGE_SIZE_DEFAULT,
  type DeviceBindingStatus,
} from '@fleet/sync-protocol';
import { AdminDeviceBindingService } from '../src/admin/admin-device-binding.service.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
const COMPANY = '00000000-0000-0000-0000-000000000001';
const OTHER_COMPANY = '00000000-0000-0000-0000-0000000000ff';
const DEFAULT_QUERY = { status: 'pending' as const, page: 1, pageSize: ADMIN_DEVICE_PAGE_SIZE_DEFAULT };
describe('AdminDeviceBindingService (pglite)', () => {
  let testDb: PgliteTestDb;
  let service: AdminDeviceBindingService;
  let deviceId: string;
  // status typed to the VOCABULARY, not string: the column now declares its enum,
  // so a seed can no longer write a lifecycle state the contract rejects.
  async function seed(companyId: string, status: DeviceBindingStatus, operatorId: string): Promise<string> {
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
  it('list returns a valid AdminDeviceListResponse envelope (output is schema-validated)', () => {
    return service.list(COMPANY, DEFAULT_QUERY).then((res) => {
      expect(AdminDeviceListResponseSchema.safeParse(res).success).toBe(true);
    });
  });
  it('list returns only company-scoped rows', async () => {
    await seed(OTHER_COMPANY, 'pending', '00000000-0000-0000-0000-0000000000b2');
    const res = await service.list(COMPANY, DEFAULT_QUERY);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.deviceId).toBe(deviceId);
    expect(res.total).toBe(1);
  });
  it('list filters by status (only the requested lifecycle state)', async () => {
    await seed(COMPANY, 'active', '00000000-0000-0000-0000-0000000000a2');
    await seed(COMPANY, 'revoked', '00000000-0000-0000-0000-0000000000a3');
    const pending = await service.list(COMPANY, { ...DEFAULT_QUERY, status: 'pending' });
    expect(pending.total).toBe(1);
    expect(pending.data.every((d) => d.bindingStatus === 'pending')).toBe(true);
    const active = await service.list(COMPANY, { ...DEFAULT_QUERY, status: 'active' });
    expect(active.total).toBe(1);
    expect(active.data[0]?.bindingStatus).toBe('active');
  });
  it('list paginates: page 1 fills, page 2 holds the remainder, hasMore flips', async () => {
    for (let i = 0; i < 2; i += 1) {
      await seed(COMPANY, 'pending', '00000000-0000-0000-0000-0000000000c' + String(i));
    }
    const page1 = await service.list(COMPANY, { status: 'pending', page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await service.list(COMPANY, { status: 'pending', page: 2, pageSize: 2 });
    expect(page2.data).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });
  it('list serializes attestationVerifiedAt to an ISO string when set', async () => {
    const when = new Date();
    await testDb.db
      .update(deviceRegistry)
      .set({ attestationVerifiedAt: when, attestationSecurityLevel: 'strongbox', attestationEnvironment: 'production' })
      .where(eq(deviceRegistry.deviceId, deviceId));
    const res = await service.list(COMPANY, DEFAULT_QUERY);
    expect(res.data[0]?.attestationVerifiedAt).toBe(when.toISOString());
    expect(res.data[0]?.attestationSecurityLevel).toBe('strongbox');
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
  it('revoke without a reason stores null', async () => {
    await service.setBinding(COMPANY, deviceId, { action: 'revoke' });
    const rows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    expect(rows[0]?.bindingStatus).toBe('revoked');
    expect(rows[0]?.bindingRevokedReason).toBeNull();
  });
  it('list returns an empty page with total 0 when no device matches the status', async () => {
    // Only the pending seed exists; filter to revoked -> zero rows. Exercises the
    // total === 0 -> totalPages 0 branch and hasMore false on an empty result.
    const res = await service.list(COMPANY, { ...DEFAULT_QUERY, status: 'revoked' });
    expect(res.data).toHaveLength(0);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(0);
    expect(res.hasMore).toBe(false);
  });
  it('setBinding on another company device throws not-found', async () => {
    const otherId = await seed(OTHER_COMPANY, 'pending', '00000000-0000-0000-0000-0000000000c3');
    await expect(service.setBinding(COMPANY, otherId, { action: 'activate' })).rejects.toThrow(/not found/i);
  });
});
