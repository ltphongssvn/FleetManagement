// apps/api/test/dispatch-roster-split.service.integration.test.ts
// RED: DispatchRosterSplitService.split(). PGlite-backed.
//
// WHAT THE OWNER IS ACTUALLY ASKING. He opens the app and wants ONE glance to
// answer: who is on the road today, and who is sitting at home with an idle
// truck. The second column is the one with teeth - a driver in it is either a
// real efficiency question or a dispatcher who sent the job over Zalo so it
// never entered the app at all.
//
// THE PARTITION IS THE CONTRACT. dispatched + idle must cover the active
// roster EXACTLY. A dropped driver is worse than a wrong number because the
// omission is invisible. isRosterPartitionValid from the SSOT contract is
// asserted here rather than re-implemented.
//
// Proves: the VN calendar-day window (an 18:00 UTC run is TOMORROW in
// Vietnam), cancelled runs do NOT count as on-the-road, soft-deleted
// projection rows are ignored, inactive drivers leave the roster entirely,
// a driver with no active vehicle assignment is idle for the RIGHT reason,
// per-driver dedupe across multiple runs, company scoping, and that the
// payload parses against DispatchRosterSplitSchema.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DispatchRosterSplitSchema, isRosterPartitionValid } from '@fleet/sync-protocol';
import { DispatchRosterSplitService } from '../src/dispatch/dispatch-roster-split.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { dispatchBoardProjection } from '../src/database/schema/projections.js';
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

// 05:00 UTC on 01 Aug = 12:00 the SAME day in Vietnam (UTC+7).
const NOW = new Date('2026-08-01T05:00:00.000Z');
// 00:30 VN on 01 Aug - inside today, though it is still 31 Jul in UTC.
const TODAY_VN_EARLY = new Date('2026-07-31T17:30:00.000Z');
// 23:30 VN on 31 Jul - YESTERDAY in Vietnam.
const YESTERDAY_VN_LATE = new Date('2026-07-31T16:30:00.000Z');
// 01:00 VN on 02 Aug - TOMORROW in Vietnam.
const TOMORROW_VN = new Date('2026-08-01T18:00:00.000Z');

interface SeededDriver {
  readonly driverId: string;
  readonly operatorId: string;
}

async function seedDriver(
  name: string,
  opts: { active?: boolean; companyId?: string } = {},
): Promise<SeededDriver> {
  const operatorId = randomUUID();
  const tenancy = opts.companyId === undefined ? TENANCY : { ...TENANCY, companyId: opts.companyId };
  const [row] = await testDb.db.insert(driver)
    .values({ ...tenancy, fullName: name, operatorId, active: opts.active ?? true })
    .returning({ driverId: driver.driverId });
  if (row === undefined) throw new Error('driver seed failed');
  return { driverId: row.driverId, operatorId };
}

async function seedVehicleFor(
  d: SeededDriver,
  plate: string,
  opts: { revoked?: boolean; companyId?: string } = {},
): Promise<string> {
  const tenancy = opts.companyId === undefined ? TENANCY : { ...TENANCY, companyId: opts.companyId };
  const [v] = await testDb.db.insert(vehicle)
    .values({ ...tenancy, plate })
    .returning({ vehicleId: vehicle.vehicleId });
  if (v === undefined) throw new Error('vehicle seed failed');
  await testDb.db.insert(driverVehicleAssignment).values({
    ...tenancy,
    driverId: d.driverId,
    vehicleId: v.vehicleId,
    revokedAt: opts.revoked === true ? new Date('2026-07-01T00:00:00.000Z') : null,
  });
  return v.vehicleId;
}

async function seedRun(
  d: SeededDriver,
  plannedStartAt: Date | null,
  opts: { state?: string; vehicleId?: string; deleted?: boolean; companyId?: string } = {},
): Promise<string> {
  const roadRunId = randomUUID();
  const tenancy = opts.companyId === undefined ? TENANCY : { ...TENANCY, companyId: opts.companyId };
  await testDb.db.insert(dispatchBoardProjection).values({
    ...tenancy,
    roadRunId,
    state: (opts.state ?? 'dispatched') as never,
    assignedOperatorId: d.operatorId,
    assignedAssetId: opts.vehicleId ?? null,
    plannedStartAt,
    stopCount: 2,
    transportOrderRefs: ['XTT.08-001'],
    serverSeq: 1n,
    deletedAt: opts.deleted === true ? new Date('2026-08-01T00:00:00.000Z') : null,
  });
  return roadRunId;
}

describe('@fleet/api - DispatchRosterSplitService.split', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_rostersplit'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await truncateAllTables(testDb.db); });

  function svc(): DispatchRosterSplitService {
    return new DispatchRosterSplitService(testDb.db as never, () => NOW);
  }

  it('returns an empty split with the VN day of the injected clock', async () => {
    const s = await svc().split({ companyId: COMPANY });
    expect(s.day).toBe('2026-08-01');
    expect(s.totalDrivers).toBe(0);
    expect(s.dispatched).toHaveLength(0);
    expect(s.idle).toHaveLength(0);
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 30_000);

  it('splits the roster into on-the-road and staying-home with plates on both sides', async () => {
    const onRoad = await seedDriver('LE VAN CHAU');
    const vid = await seedVehicleFor(onRoad, '51A-11111');
    await seedRun(onRoad, TODAY_VN_EARLY, { vehicleId: vid });
    const home = await seedDriver('NGUYEN VAN MAU');
    await seedVehicleFor(home, '51A-22222');

    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(2);
    expect(s.dispatched).toHaveLength(1);
    expect(s.idle).toHaveLength(1);
    expect(s.dispatched[0]?.driverName).toBe('LE VAN CHAU');
    expect(s.dispatched[0]?.vehiclePlate).toBe('51A-11111');
    expect(s.idle[0]?.driverName).toBe('NGUYEN VAN MAU');
    expect(s.idle[0]?.vehiclePlate).toBe('51A-22222');
    expect(s.idle[0]?.reason).toBe('no_dispatch_today');
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 30_000);

  it('uses the Asia/Ho_Chi_Minh day boundary, not the UTC one', async () => {
    const early = await seedDriver('VN TODAY 0030');
    await seedVehicleFor(early, '51A-33333');
    await seedRun(early, TODAY_VN_EARLY);
    const yest = await seedDriver('VN YESTERDAY 2330');
    await seedVehicleFor(yest, '51A-44444');
    await seedRun(yest, YESTERDAY_VN_LATE);
    const tom = await seedDriver('VN TOMORROW 0100');
    await seedVehicleFor(tom, '51A-55555');
    await seedRun(tom, TOMORROW_VN);

    const s = await svc().split({ companyId: COMPANY });
    expect(s.dispatched).toHaveLength(1);
    expect(s.dispatched[0]?.driverName).toBe('VN TODAY 0030');
    expect(s.idle).toHaveLength(2);
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 30_000);

  it('does NOT count a cancelled run as on the road', async () => {
    const d = await seedDriver('CANCELLED TODAY');
    await seedVehicleFor(d, '51A-66666');
    await seedRun(d, TODAY_VN_EARLY, { state: 'cancelled' });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.dispatched).toHaveLength(0);
    expect(s.idle).toHaveLength(1);
    expect(s.idle[0]?.reason).toBe('no_dispatch_today');
  }, 30_000);

  it('counts planned, dispatched, started and completed runs as on the road', async () => {
    for (const state of ['planned', 'dispatched', 'started', 'completed']) {
      const d = await seedDriver('STATE ' + state.toUpperCase());
      await seedRun(d, TODAY_VN_EARLY, { state });
    }
    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(4);
    expect(s.dispatched).toHaveLength(4);
    expect(s.idle).toHaveLength(0);
  }, 30_000);

  it('ignores a soft-deleted projection row', async () => {
    const d = await seedDriver('TOMBSTONED RUN');
    await seedVehicleFor(d, '51A-77777');
    await seedRun(d, TODAY_VN_EARLY, { deleted: true });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.dispatched).toHaveLength(0);
    expect(s.idle).toHaveLength(1);
  }, 30_000);

  it('ignores a run with a null planned start (unscheduled, not today)', async () => {
    const d = await seedDriver('NULL PLANNED START');
    await seedRun(d, null);
    const s = await svc().split({ companyId: COMPANY });
    expect(s.dispatched).toHaveLength(0);
    expect(s.idle).toHaveLength(1);
  }, 30_000);

  it('reports no_vehicle_assigned when the driver has no active assignment', async () => {
    const never = await seedDriver('NEVER ASSIGNED');
    const revoked = await seedDriver('ASSIGNMENT REVOKED');
    await seedVehicleFor(revoked, '51A-88888', { revoked: true });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.idle).toHaveLength(2);
    for (const row of s.idle) {
      expect(row.reason).toBe('no_vehicle_assigned');
      expect(row.vehiclePlate).toBeNull();
    }
    expect(never.driverId).not.toBe(revoked.driverId);
  }, 30_000);

  it('lists a driver ONCE even with several runs today', async () => {
    const d = await seedDriver('THREE RUNS TODAY');
    await seedVehicleFor(d, '51A-99999');
    await seedRun(d, TODAY_VN_EARLY);
    await seedRun(d, NOW);
    await seedRun(d, NOW, { state: 'started' });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(1);
    expect(s.dispatched).toHaveLength(1);
    expect(s.idle).toHaveLength(0);
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 30_000);

  it('excludes an inactive driver from the roster entirely', async () => {
    await seedDriver('ACTIVE ONE');
    await seedDriver('SOFT DELETED', { active: false });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(1);
    expect(s.dispatched.length + s.idle.length).toBe(1);
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 30_000);

  it('scopes the whole split to the requested company', async () => {
    const mine = await seedDriver('MINE');
    await seedRun(mine, TODAY_VN_EARLY);
    const theirs = await seedDriver('THEIRS', { companyId: OTHER_COMPANY });
    await seedRun(theirs, TODAY_VN_EARLY, { companyId: OTHER_COMPANY });

    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(1);
    expect(s.dispatched).toHaveLength(1);
    expect(s.dispatched[0]?.driverName).toBe('MINE');
  }, 30_000);

  it('produces a payload that parses against the DispatchRosterSplitSchema SSOT', async () => {
    const d = await seedDriver('CONTRACT SHAPE');
    await seedVehicleFor(d, '51A-10101');
    await seedRun(d, TODAY_VN_EARLY);
    const s = await svc().split({ companyId: COMPANY });
    const parsed = DispatchRosterSplitSchema.safeParse(s);
    expect(parsed.success).toBe(true);
  }, 30_000);

  it('holds the partition invariant across a mixed 22-driver roster', async () => {
    for (let i = 0; i < 8; i += 1) {
      const d = await seedDriver('ROAD ' + String(i));
      await seedVehicleFor(d, '51A-A' + String(i));
      await seedRun(d, TODAY_VN_EARLY);
    }
    for (let i = 0; i < 11; i += 1) {
      const d = await seedDriver('HOME ' + String(i));
      await seedVehicleFor(d, '51A-B' + String(i));
    }
    for (let i = 0; i < 3; i += 1) {
      await seedDriver('NOVEHICLE ' + String(i));
    }

    const s = await svc().split({ companyId: COMPANY });
    expect(s.totalDrivers).toBe(22);
    expect(s.dispatched).toHaveLength(8);
    expect(s.idle).toHaveLength(14);
    expect(s.idle.filter((r) => r.reason === 'no_vehicle_assigned')).toHaveLength(3);
    expect(s.idle.filter((r) => r.reason === 'no_dispatch_today')).toHaveLength(11);
    expect(isRosterPartitionValid(s)).toBe(true);
  }, 60_000);
});
