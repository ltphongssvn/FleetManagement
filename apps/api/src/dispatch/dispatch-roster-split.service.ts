// apps/api/src/dispatch/dispatch-roster-split.service.ts
// Dispatched-vs-idle roster split for the Bang dieu phoi xe owner panel.
//
// WHAT THIS ANSWERS. The owner opens the app and needs ONE glance: who is on
// the road today, and who is at home with an idle truck. The idle column is
// the one with teeth - a driver there is either a real efficiency question or
// a dispatcher who sent the job over Zalo, so the run never entered the app.
// That is why every idle row carries a REASON: no_vehicle_assigned means the
// driver COULD NOT be dispatched (an assignment problem), while
// no_dispatch_today means he could have been and was not (the adoption gap).
//
// READ PATH. Driver identity on the board projection is assigned_operator_id,
// which maps to driver.operator_id (NOT driver_id) - the same join the board
// controller uses. Reads filter deleted_at IS NULL per the soft-delete
// convention: the app role holds no DELETE, so a removed run is a tombstone.
//
// TODAY is the Asia/Ho_Chi_Minh calendar day from the @fleet/domain SSOT
// vnDayWindowUtc, NOT a UTC slice: a run planned at 00:30 Vietnam time is
// still yesterday in UTC, and the owner reads this board in the morning.
// The clock is injected so the window is deterministic in tests.
//
// PARTITION. dispatched + idle covers the active roster exactly. Idle is
// computed as roster MINUS dispatched rather than by its own query, so a
// driver can never fall through both filters and vanish from the panel - an
// invisible omission is worse than a wrong count.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { vnDayWindowUtc } from '@fleet/domain';
import { ROAD_RUN_STATES } from '@fleet/sync-protocol';
import type { DispatchRosterSplit, DispatchedDriverRow, IdleDriverRow } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { dispatchBoardProjection } from '../database/schema/projections.js';

export type NowFn = () => Date;
export const ROSTER_SPLIT_NOW = Symbol('ROSTER_SPLIT_NOW');

export interface RosterSplitInput {
  readonly companyId: string;
}

// A cancelled run means the driver is NOT on the road, so it must not count as
// dispatched - otherwise a cancelled job would mask a truck sitting idle.
// Derived from the SSOT lifecycle vocabulary so a future state is included by
// default rather than silently dropped.
const ON_ROAD_STATES = ROAD_RUN_STATES.filter((s) => s !== 'cancelled');

@Injectable()
export class DispatchRosterSplitService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(ROSTER_SPLIT_NOW) private readonly now: NowFn,
  ) {}

  async split(input: RosterSplitInput): Promise<DispatchRosterSplit> {
    const instant = this.now();
    const { day, startUtc, endUtc } = vnDayWindowUtc(instant);
    const companyId = input.companyId;

    // Active roster + the plate of the currently assigned truck (if any).
    // LEFT JOIN on the partial-unique active assignment: at most one row per
    // driver survives revoked_at IS NULL, so this cannot fan out.
    const rosterRows = await this.db
      .select({
        driverId: driver.driverId,
        driverName: driver.fullName,
        operatorId: driver.operatorId,
        assignedPlate: vehicle.plate,
      })
      .from(driver)
      .leftJoin(driverVehicleAssignment, and(
        eq(driverVehicleAssignment.driverId, driver.driverId),
        eq(driverVehicleAssignment.companyId, companyId),
        isNull(driverVehicleAssignment.revokedAt),
      ))
      .leftJoin(vehicle, and(
        eq(vehicle.vehicleId, driverVehicleAssignment.vehicleId),
        eq(vehicle.companyId, companyId),
      ))
      .where(and(eq(driver.companyId, companyId), eq(driver.active, true)))
      .orderBy(asc(driver.fullName));

    // Runs whose planned start falls inside the VN day window. Ordered by
    // planned start so the FIRST row wins per driver: several runs today
    // collapse to the earliest, and the driver is listed exactly once.
    const runRows = await this.db
      .select({
        roadRunId: dispatchBoardProjection.roadRunId,
        state: dispatchBoardProjection.state,
        assignedOperatorId: dispatchBoardProjection.assignedOperatorId,
        plannedStartAt: dispatchBoardProjection.plannedStartAt,
        transportOrderRefs: dispatchBoardProjection.transportOrderRefs,
        runPlate: vehicle.plate,
      })
      .from(dispatchBoardProjection)
      .leftJoin(vehicle, and(
        eq(vehicle.vehicleId, dispatchBoardProjection.assignedAssetId),
        eq(vehicle.companyId, companyId),
      ))
      .where(and(
        eq(dispatchBoardProjection.companyId, companyId),
        isNull(dispatchBoardProjection.deletedAt),
        inArray(dispatchBoardProjection.state, [...ON_ROAD_STATES]),
        gte(dispatchBoardProjection.plannedStartAt, startUtc),
        lt(dispatchBoardProjection.plannedStartAt, endUtc),
      ))
      .orderBy(asc(dispatchBoardProjection.plannedStartAt));

    // Earliest run today per operator. A null assigned_operator_id cannot be
    // attributed to a driver, so it is skipped rather than guessed.
    const runByOperator = new Map<string, typeof runRows[number]>();
    for (const run of runRows) {
      const opId = run.assignedOperatorId;
      if (opId === null) continue;
      if (!runByOperator.has(opId)) runByOperator.set(opId, run);
    }

    const dispatched: DispatchedDriverRow[] = [];
    const idle: IdleDriverRow[] = [];

    for (const person of rosterRows) {
      const run = person.operatorId === null ? undefined : runByOperator.get(person.operatorId);
      if (run !== undefined) {
        dispatched.push({
          driverId: person.driverId,
          driverName: person.driverName,
          // Prefer the truck actually on the run; fall back to the standing
          // assignment so the owner still sees WHICH truck is out when the
          // projection carries no asset.
          vehiclePlate: run.runPlate ?? person.assignedPlate,
          roadRunId: run.roadRunId,
          state: run.state,
          plannedStartAt: run.plannedStartAt === null ? null : run.plannedStartAt.toISOString(),
          orderRefs: run.transportOrderRefs,
        });
        continue;
      }
      idle.push({
        driverId: person.driverId,
        driverName: person.driverName,
        vehiclePlate: person.assignedPlate,
        reason: person.assignedPlate === null ? 'no_vehicle_assigned' : 'no_dispatch_today',
      });
    }

    return {
      day,
      asOf: instant.toISOString(),
      totalDrivers: rosterRows.length,
      dispatched,
      idle,
    };
  }
}
