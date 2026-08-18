// apps/api/test/owner-metrics.service.integration.test.ts
// RED: OwnerMetricsService.adoption(). PGlite-backed. Proves the funnel
// (total/deviceRegistered/appInstalled/activeToday/notInstalled), the
// Asia/Ho_Chi_Minh calendar-day window for activeToday (UTC evening =
// next VN day), per-driver dedupe across multiple devices, inactive-driver
// exclusion, company scoping, and that the wire shape parses against the
// OwnerAdoptionMetricsSchema SSOT.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OwnerAdoptionMetricsSchema } from '@fleet/sync-protocol';
import type { Platform } from '../src/device/platform.js';
import { OwnerMetricsService } from '../src/owner/owner-metrics.service.js';
import { driver } from '../src/database/schema/reference.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000000';
const OTHER_COMPANY = '11111111-1111-1111-1111-111111111111';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};
// 18:00 UTC = 01:00 the NEXT day in Asia/Ho_Chi_Minh (UTC+7).
const NOW = new Date('2026-07-06T18:00:00.000Z');
const SAME_VN_DAY = new Date('2026-07-06T17:30:00.000Z');   // 00:30 VN 07-07
const PREV_VN_DAY = new Date('2026-07-06T16:30:00.000Z');   // 23:30 VN 07-06

async function seedDriver(name: string, opts: { active?: boolean; operatorId?: string | null; companyId?: string } = {}): Promise<{ driverId: string; operatorId: string | null }> {
  const operatorId = opts.operatorId === undefined ? randomUUID() : opts.operatorId;
  const tenancy = opts.companyId === undefined ? TENANCY : { ...TENANCY, companyId: opts.companyId };
  const [d] = await testDb.db.insert(driver)
    .values({ ...tenancy, fullName: name, operatorId, active: opts.active ?? true })
    .returning({ driverId: driver.driverId });
  if (d === undefined) throw new Error('seed failed');
  return { driverId: d.driverId, operatorId };
}

async function seedDevice(operatorId: string, platform: Platform, appVersion: string, lastSeenAt: Date | null, companyId: string = COMPANY): Promise<void> {
  await testDb.db.insert(deviceRegistry).values({
    ...TENANCY,
    companyId,
    operatorId,
    platform,
    appVersion,
    lastSeenAt,
  });
}

describe('@fleet/api - OwnerMetricsService.adoption', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_ownermetrics'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await truncateAllTables(testDb.db); });

  function svc(): OwnerMetricsService {
    return new OwnerMetricsService(testDb.db as never, () => NOW);
  }

  it('returns all zeros on an empty roster with the VN day of the injected clock', async () => {
    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.totalDrivers).toBe(0);
    expect(m.deviceRegistered).toBe(0);
    expect(m.appInstalled).toBe(0);
    expect(m.activeToday).toBe(0);
    expect(m.notInstalled).toBe(0);
    expect(m.day).toBe('2026-07-07');
  });

  it('computes the full funnel with per-driver dedupe and inactive exclusion', async () => {
    const d1 = await seedDriver('D1 TWO DEVICES INSTALLED ACTIVE');
    if (d1.operatorId === null) throw new Error('unreachable');
    await seedDevice(d1.operatorId, 'android', '1.2.0', SAME_VN_DAY);
    await seedDevice(d1.operatorId, 'ios', '1.2.0', PREV_VN_DAY);
    const d2 = await seedDriver('D2 UDID PREENROLL ONLY');
    if (d2.operatorId === null) throw new Error('unreachable');
    await seedDevice(d2.operatorId, 'ios', '0.0.0', PREV_VN_DAY);
    const d3 = await seedDriver('D3 INSTALLED YESTERDAY');
    if (d3.operatorId === null) throw new Error('unreachable');
    await seedDevice(d3.operatorId, 'android', '1.0.0', PREV_VN_DAY);
    await seedDriver('D4 NO DEVICE');
    await seedDriver('D5 INACTIVE', { active: false });

    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.totalDrivers).toBe(4);
    expect(m.deviceRegistered).toBe(3);
    expect(m.appInstalled).toBe(2);
    expect(m.activeToday).toBe(1);
    expect(m.notInstalled).toBe(2);
  }, 30_000);

  it('applies the Asia/Ho_Chi_Minh day boundary, not the UTC one', async () => {
    const d1 = await seedDriver('VN SAME DAY 0030');
    if (d1.operatorId === null) throw new Error('unreachable');
    await seedDevice(d1.operatorId, 'android', '2.0.0', SAME_VN_DAY);
    const d2 = await seedDriver('VN PREV DAY 2330');
    if (d2.operatorId === null) throw new Error('unreachable');
    await seedDevice(d2.operatorId, 'android', '2.0.0', PREV_VN_DAY);

    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.day).toBe('2026-07-07');
    expect(m.appInstalled).toBe(2);
    expect(m.activeToday).toBe(1);
  }, 30_000);

  it('treats a null lastSeenAt on an installed version as not active today', async () => {
    const d1 = await seedDriver('NULL LASTSEEN');
    if (d1.operatorId === null) throw new Error('unreachable');
    await seedDevice(d1.operatorId, 'android', '1.0.0', null);
    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.appInstalled).toBe(1);
    expect(m.activeToday).toBe(0);
  }, 30_000);

  it('ignores drivers with a null operatorId in device joins but counts them in the roster', async () => {
    await seedDriver('NO OPERATOR BINDING', { operatorId: null });
    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.totalDrivers).toBe(1);
    expect(m.deviceRegistered).toBe(0);
    expect(m.notInstalled).toBe(1);
  }, 30_000);

  it('scopes every count to the requested company', async () => {
    const mine = await seedDriver('MINE INSTALLED');
    if (mine.operatorId === null) throw new Error('unreachable');
    await seedDevice(mine.operatorId, 'android', '1.0.0', SAME_VN_DAY);
    const theirs = await seedDriver('THEIRS', { companyId: OTHER_COMPANY });
    if (theirs.operatorId === null) throw new Error('unreachable');
    await seedDevice(theirs.operatorId, 'android', '1.0.0', SAME_VN_DAY, OTHER_COMPANY);

    const m = await svc().adoption({ companyId: COMPANY });
    expect(m.totalDrivers).toBe(1);
    expect(m.appInstalled).toBe(1);
    expect(m.activeToday).toBe(1);
  }, 30_000);

  it('produces a payload that parses against the OwnerAdoptionMetricsSchema SSOT', async () => {
    const m = await svc().adoption({ companyId: COMPANY });
    const parsed = OwnerAdoptionMetricsSchema.safeParse(m);
    expect(parsed.success).toBe(true);
  }, 30_000);
});
