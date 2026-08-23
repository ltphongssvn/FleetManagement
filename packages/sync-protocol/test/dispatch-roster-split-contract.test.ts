// packages/sync-protocol/test/dispatch-roster-split-contract.test.ts
// RED (contract-first): SSOT wire contract for the Bang dieu phoi xe
// dispatched-vs-idle driver split panel - two side-by-side tables the owner
// reads at a glance: who is on the road today, and who stays home with an
// idle truck.
//
// 2026 fleet-dashboard practice separates "available but idle" (a dispatch /
// app-adoption problem the owner acts on) from "cannot be dispatched" (no
// active vehicle), so every idle row carries a REASON. A bare name list would
// not tell the owner whether to push in-app dispatch or fix an assignment.
//
// The load-bearing rule is the PARTITION: dispatched + idle must cover the
// whole active roster exactly - no driver in both, none dropped. A silently
// dropped driver is worse than a wrong count because the owner cannot see the
// omission.
import { describe, it, expect } from 'vitest';
import {
  DispatchRosterSplitSchema,
  DispatchedDriverRowSchema,
  IdleDriverRowSchema,
  IDLE_REASONS,
  parseDispatchRosterSplit,
  isRosterPartitionValid,
} from '../src/dispatch-roster-split-contract.js';

const DRIVER_A = '11111111-1111-4111-8111-111111111111';
const DRIVER_B = '22222222-2222-4222-8222-222222222222';
const RUN_1 = '33333333-3333-4333-8333-333333333333';

function dispatchedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    driverId: DRIVER_A,
    driverName: 'LE VAN CHAU',
    vehiclePlate: '51A-12345',
    roadRunId: RUN_1,
    state: 'dispatched',
    plannedStartAt: '2026-08-01T01:00:00.000Z',
    orderRefs: ['XTT.08-001'],
    ...overrides,
  };
}

function idleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    driverId: DRIVER_B,
    driverName: 'NGUYEN VAN MAU',
    vehiclePlate: '51A-67890',
    reason: 'no_dispatch_today',
    ...overrides,
  };
}

function split(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: '2026-08-01',
    asOf: '2026-08-01T03:15:00.000Z',
    totalDrivers: 2,
    dispatched: [dispatchedRow()],
    idle: [idleRow()],
    ...overrides,
  };
}

describe('@fleet/sync-protocol - dispatch roster split contract', () => {
  it('accepts a well-formed split payload', () => {
    const parsed = DispatchRosterSplitSchema.safeParse(split());
    expect(parsed.success).toBe(true);
  });

  it('exposes the idle-reason vocabulary as the SSOT', () => {
    expect(IDLE_REASONS).toEqual(['no_dispatch_today', 'no_vehicle_assigned']);
  });

  it('rejects an idle reason outside the vocabulary', () => {
    const parsed = IdleDriverRowSchema.safeParse(idleRow({ reason: 'on_holiday' }));
    expect(parsed.success).toBe(false);
  });

  it('allows a null vehicle plate on both sides (driver with no active assignment)', () => {
    expect(DispatchedDriverRowSchema.safeParse(dispatchedRow({ vehiclePlate: null })).success).toBe(
      true,
    );
    expect(
      IdleDriverRowSchema.safeParse(idleRow({ vehiclePlate: null, reason: 'no_vehicle_assigned' }))
        .success,
    ).toBe(true);
  });

  it('rejects a road-run state outside the SSOT lifecycle vocabulary', () => {
    const parsed = DispatchedDriverRowSchema.safeParse(dispatchedRow({ state: 'en_route' }));
    expect(parsed.success).toBe(false);
  });

  it('requires day to be a YYYY-MM-DD calendar key', () => {
    expect(DispatchRosterSplitSchema.safeParse(split({ day: '01-08-2026' })).success).toBe(false);
  });

  it('rejects a negative roster total', () => {
    expect(DispatchRosterSplitSchema.safeParse(split({ totalDrivers: -1 })).success).toBe(false);
  });

  it('parse helper returns null instead of throwing on a malformed payload', () => {
    expect(parseDispatchRosterSplit({ nope: true })).toBeNull();
  });

  it('parse helper returns the typed payload on success', () => {
    const parsed = parseDispatchRosterSplit(split());
    expect(parsed).not.toBeNull();
    expect(parsed?.totalDrivers).toBe(2);
  });

  it('partition holds when dispatched + idle equals the roster total with no overlap', () => {
    const parsed = parseDispatchRosterSplit(split());
    expect(parsed).not.toBeNull();
    expect(parsed === null ? false : isRosterPartitionValid(parsed)).toBe(true);
  });

  it('partition FAILS when a driver appears in both columns', () => {
    const parsed = parseDispatchRosterSplit(split({ idle: [idleRow({ driverId: DRIVER_A })] }));
    expect(parsed).not.toBeNull();
    expect(parsed === null ? true : isRosterPartitionValid(parsed)).toBe(false);
  });

  it('partition FAILS when a roster driver is dropped from both columns', () => {
    const parsed = parseDispatchRosterSplit(split({ totalDrivers: 22 }));
    expect(parsed).not.toBeNull();
    expect(parsed === null ? true : isRosterPartitionValid(parsed)).toBe(false);
  });

  it('partition holds for an empty roster (nobody hired yet)', () => {
    const parsed = parseDispatchRosterSplit(split({ totalDrivers: 0, dispatched: [], idle: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed === null ? false : isRosterPartitionValid(parsed)).toBe(true);
  });
});
