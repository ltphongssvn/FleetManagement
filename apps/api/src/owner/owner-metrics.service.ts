// apps/api/src/owner/owner-metrics.service.ts
// Owner adoption dashboard aggregation. Server-derived funnel over
// driver + device_registry (zero new tables):
//   totalDrivers     COUNT(driver) WHERE active
//   deviceRegistered COUNT(DISTINCT operator) with ANY device row
//   appInstalled     COUNT(DISTINCT operator) with appVersion <> '0.0.0'
//                    ('0.0.0' is the admin UDID pre-enroll placeholder;
//                    a real version only ever comes from the running app)
//   activeToday      appInstalled AND last_seen_at inside the CURRENT
//                    Asia/Ho_Chi_Minh calendar day (pilot is VN-local;
//                    UTC day boundaries would misattribute evening use)
//   notInstalled     totalDrivers - appInstalled
// Clock is injected (NowFn) so the VN day window is deterministic in tests.
// Wire shape is the @fleet/sync-protocol OwnerAdoptionMetricsSchema SSOT.
import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, eq, gte, isNotNull, lt, ne } from 'drizzle-orm';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { deviceRegistry } from '../database/schema/device.js';

export type NowFn = () => Date;
export const OWNER_METRICS_NOW = Symbol('OWNER_METRICS_NOW');

export interface AdoptionInput {
  readonly companyId: string;
}

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const ADMIN_PREENROLL_VERSION = '0.0.0';
const DAY_MS = 24 * 60 * 60 * 1000;

// YYYY-MM-DD of the instant in Asia/Ho_Chi_Minh (en-CA locale emits ISO order).
function vnDayOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// [startUtc, endUtc) of the VN calendar day containing the instant.
// VN is fixed UTC+7 (no DST), so midnight VN = day 00:00:00+07:00 exactly.
function vnDayWindowUtc(instant: Date): { readonly day: string; readonly startUtc: Date; readonly endUtc: Date } {
  const day = vnDayOf(instant);
  const startUtc = new Date(day + 'T00:00:00.000+07:00');
  const endUtc = new Date(startUtc.getTime() + DAY_MS);
  return { day, startUtc, endUtc };
}

@Injectable()
export class OwnerMetricsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(OWNER_METRICS_NOW) private readonly now: NowFn,
  ) {}

  async adoption(input: AdoptionInput): Promise<OwnerAdoptionMetrics> {
    const instant = this.now();
    const { day, startUtc, endUtc } = vnDayWindowUtc(instant);

    const activeDriverJoin = and(
      eq(deviceRegistry.operatorId, driver.operatorId),
      eq(deviceRegistry.companyId, driver.companyId),
    );
    const rosterWhere = and(eq(driver.companyId, input.companyId), eq(driver.active, true));
    const installedWhere = and(rosterWhere, ne(deviceRegistry.appVersion, ADMIN_PREENROLL_VERSION));

    const [totalRow] = await this.db
      .select({ n: count() })
      .from(driver)
      .where(rosterWhere);

    const [registeredRow] = await this.db
      .select({ n: countDistinct(deviceRegistry.operatorId) })
      .from(deviceRegistry)
      .innerJoin(driver, activeDriverJoin)
      .where(rosterWhere);

    const [installedRow] = await this.db
      .select({ n: countDistinct(deviceRegistry.operatorId) })
      .from(deviceRegistry)
      .innerJoin(driver, activeDriverJoin)
      .where(installedWhere);

    const [activeRow] = await this.db
      .select({ n: countDistinct(deviceRegistry.operatorId) })
      .from(deviceRegistry)
      .innerJoin(driver, activeDriverJoin)
      .where(and(
        installedWhere,
        isNotNull(deviceRegistry.lastSeenAt),
        gte(deviceRegistry.lastSeenAt, startUtc),
        lt(deviceRegistry.lastSeenAt, endUtc),
      ));

    // A COUNT/COUNT(DISTINCT) with no GROUP BY always returns exactly one
    // row, so the destructured row is never undefined and the ?? 0 fallback
    // branch is unreachable - defensive only, excluded from branch coverage.
    /* c8 ignore start -- non-grouped aggregate always yields one row */
    const totalDrivers = totalRow?.n ?? 0;
    const appInstalled = installedRow?.n ?? 0;
    const deviceRegistered = registeredRow?.n ?? 0;
    const activeToday = activeRow?.n ?? 0;
    /* c8 ignore stop */
    return {
      totalDrivers,
      deviceRegistered,
      appInstalled,
      activeToday,
      notInstalled: totalDrivers - appInstalled,
      asOf: instant.toISOString(),
      day,
    };
  }
}
