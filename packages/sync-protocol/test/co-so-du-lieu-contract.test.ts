// packages/sync-protocol/test/co-so-du-lieu-contract.test.ts
// RED-first contract test for the Cơ sở dữ liệu consolidated-page driver
// status SSOT. Drives DRIVER_DB_STATUSES (frozen tuple) -> driverDbStatusSchema
// (z.enum) -> DriverDbStatus (z.infer), plus classifyDriverDbStatus: a pure
// three-state collapse of the existing AdminDriverRow axes into one badge value
// the consolidated table renders. unassigned (no vehicle) -> assigned (vehicle,
// app not yet live: no device or placeholder appVersion 0.0.0) -> active
// (vehicle AND a device on a real appVersion). The 0.0.0 placeholder reuses the
// admin UDID pre-enroll convention. Codes only here; Vietnamese labels live in
// the ops-web presenter (two-tier discipline, per driver-attention-contract).
import { describe, it, expect } from 'vitest';
import {
  DRIVER_DB_STATUSES,
  driverDbStatusSchema,
  classifyDriverDbStatus,
} from '../src/co-so-du-lieu-contract.js';

describe('DRIVER_DB_STATUSES enum SSOT', () => {
  it('is the frozen three-state tuple in badge order', () => {
    expect(DRIVER_DB_STATUSES).toEqual(['unassigned', 'assigned', 'active']);
    expect(Object.isFrozen(DRIVER_DB_STATUSES)).toBe(true);
  });

  it('parses every member and rejects an unknown code', () => {
    for (const s of DRIVER_DB_STATUSES) {
      expect(driverDbStatusSchema.parse(s)).toBe(s);
    }
    expect(driverDbStatusSchema.safeParse('retired').success).toBe(false);
  });
});

describe('classifyDriverDbStatus', () => {
  const device = (
    appVersion: string,
  ): {
    deviceId: string;
    platform: string;
    appVersion: string;
    lastSeenAt: string | null;
    udid: string | null;
  } => ({
    deviceId: 'd1',
    platform: 'android',
    appVersion,
    lastSeenAt: null,
    udid: null,
  });
  const vehicle = { vehicleId: 'v1', plate: '62H 05194' };

  it('returns unassigned when no vehicle is assigned, regardless of devices', () => {
    expect(classifyDriverDbStatus({ assignedVehicle: null, devices: [device('1.4.0')] })).toBe(
      'unassigned',
    );
  });

  it('returns assigned when a vehicle is set but no device exists', () => {
    expect(classifyDriverDbStatus({ assignedVehicle: vehicle, devices: [] })).toBe('assigned');
  });

  it('returns assigned when the only device is the 0.0.0 pre-enroll placeholder', () => {
    expect(classifyDriverDbStatus({ assignedVehicle: vehicle, devices: [device('0.0.0')] })).toBe(
      'assigned',
    );
  });

  it('returns active when a vehicle is set and a device runs a real app version', () => {
    expect(
      classifyDriverDbStatus({
        assignedVehicle: vehicle,
        devices: [device('0.0.0'), device('1.4.0')],
      }),
    ).toBe('active');
  });
});
