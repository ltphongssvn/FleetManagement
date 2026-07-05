// packages/sync-protocol/test/driver-attention-contract.test.ts
// RED-first for the admin-driver SSOT + attention classification (Zod-first).
// Two-axis rule applied: AXIS 2 -- AdminDriverRowSchema is the single source
// of truth for the /admin/drivers wire row (ops-web DriverRow/DeviceInfo/
// VehicleInfo become z.infer re-exports; no hand-written duplicates). AXIS 1
// -- parseAdminDriverRows validates ONCE at the HTTP trust boundary (today a
// bare res.json() as-cast in admin-drivers-client.list); downstream data is
// trusted and never re-validated. Classification is pure over trusted rows;
// UIs map reason codes to immutable Vietnamese copy in presenters (two-tier,
// same discipline as FleetErrorCode).
import { describe, expect, it } from 'vitest';
import {
  DRIVER_ATTENTION_REASONS,
  DriverAttentionReasonSchema,
  AdminDriverRowSchema,
  parseAdminDriverRows,
  classifyDriverAttention,
  needsDriverAttention,
  type AdminDriverRow,
  type DriverAttentionReason,
} from '../src/driver-attention-contract.js';

const DEVICE = {
  deviceId: 'dev-1',
  platform: 'ios',
  appVersion: '1.4.0',
  lastSeenAt: null,
  udid: 'UDID-1',
};
const ROW: AdminDriverRow = {
  driverId: 'drv-1',
  fullName: 'Nguyen Van A',
  phone: '+84901000001',
  operatorId: 'op-1',
  assignedVehicle: { vehicleId: 'veh-1', plate: '51C-123.45' },
  assignmentId: 'asg-1',
  devices: [DEVICE],
};

describe('admin-driver row SSOT', () => {
  it('parses a full wire row', () => {
    const parsed = AdminDriverRowSchema.parse(ROW);
    expect(parsed.driverId).toBe('drv-1');
    expect(parsed.devices).toHaveLength(1);
  });

  it('accepts wire nulls on every nullable field', () => {
    const parsed = AdminDriverRowSchema.parse({
      ...ROW,
      phone: null,
      operatorId: null,
      assignedVehicle: null,
      assignmentId: null,
      devices: [],
    });
    expect(parsed.assignedVehicle).toBeNull();
  });

  it('is loose: unknown wire members survive the parse', () => {
    const parsed = AdminDriverRowSchema.parse({ ...ROW, futureField: 'kept' });
    expect((parsed as Record<string, unknown>)['futureField']).toBe('kept');
  });

  it('parseAdminDriverRows returns rows for a valid array', () => {
    const rows = parseAdminDriverRows([ROW, { ...ROW, driverId: 'drv-2' }]);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
  });

  it('parseAdminDriverRows returns null, never throws, on junk', () => {
    expect(parseAdminDriverRows([{ ...ROW, driverId: 42 }])).toBeNull();
    expect(parseAdminDriverRows({ rows: [ROW] })).toBeNull();
    expect(parseAdminDriverRows(null)).toBeNull();
    expect(parseAdminDriverRows('junk')).toBeNull();
  });
});

describe('driver-attention classification', () => {
  it('exposes exactly the two producer reason codes in stable order', () => {
    expect(DRIVER_ATTENTION_REASONS).toEqual([
      'VEHICLE_UNASSIGNED',
      'DEVICE_UNREGISTERED',
    ]);
  });

  it('reason schema is the strict producer union', () => {
    expect(DriverAttentionReasonSchema.safeParse('VEHICLE_UNASSIGNED').success).toBe(true);
    expect(DriverAttentionReasonSchema.safeParse('DEVICE_UNREGISTERED').success).toBe(true);
    expect(DriverAttentionReasonSchema.safeParse('A_CODE_FROM_THE_FUTURE').success).toBe(false);
  });

  it('classifies both axes missing with stable reason order', () => {
    const reasons = classifyDriverAttention({ ...ROW, assignedVehicle: null, devices: [] });
    expect(reasons).toEqual(['VEHICLE_UNASSIGNED', 'DEVICE_UNREGISTERED']);
  });

  it('classifies each single-axis gap', () => {
    expect(classifyDriverAttention({ ...ROW, devices: [] })).toEqual(['DEVICE_UNREGISTERED']);
    expect(classifyDriverAttention({ ...ROW, assignedVehicle: null })).toEqual(['VEHICLE_UNASSIGNED']);
  });

  it('a fully set-up driver needs no attention', () => {
    expect(classifyDriverAttention(ROW)).toEqual([]);
    expect(needsDriverAttention(ROW)).toBe(false);
    expect(needsDriverAttention({ ...ROW, devices: [] })).toBe(true);
  });

  it('type and reason union line up', () => {
    const r: DriverAttentionReason = 'VEHICLE_UNASSIGNED';
    expect(DRIVER_ATTENTION_REASONS).toContain(r);
    const parsed: AdminDriverRow = AdminDriverRowSchema.parse(ROW);
    expect(typeof parsed.fullName).toBe('string');
  });
});
