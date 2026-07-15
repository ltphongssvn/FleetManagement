// apps/ops-web/test/co-so-du-lieu-row.test.ts
// RED-first for the driver row -> status-cell mapper the Cơ sở dữ liệu table
// renders. Pure composition of the two shipped pieces: classifyDriverDbStatus
// (AdminDriverRow facts -> DriverDbStatus code) + presentDriverDbStatus (code
// -> {label, tone}). NO new row shape -- it consumes AdminDriverRow (the SSOT)
// and emits only the status-column inputs, honouring the driver-attention arc
// lesson: derive from the SSOT via classifier+presenter, never a hand-written
// row duplicate. Rows are partitioned by status for the table, never copied.
import { describe, expect, it } from 'vitest';
import type { AdminDriverRow, AdminDriverDevice } from '@fleet/sync-protocol';
import {
  toDriverStatusCell,
  partitionDriversByStatus,
} from '@/features/admin/co-so-du-lieu-row';

const row = (over: Partial<AdminDriverRow>): AdminDriverRow => ({
  driverId: 'dr1',
  fullName: 'NGUYỄN VĂN A',
  phone: null,
  operatorId: null,
  assignedVehicle: null,
  assignmentId: null,
  devices: [],
  ...over,
});
const vehicle = { vehicleId: 'v1', plate: '62H 05194' };
const device = (appVersion: string): AdminDriverDevice => ({
  deviceId: 'd1',
  platform: 'android',
  appVersion,
  lastSeenAt: null,
  udid: null,
});

describe('toDriverStatusCell', () => {
  it('maps an unassigned driver to the warning Chưa phân công cell', () => {
    const cell = toDriverStatusCell(row({ assignedVehicle: null }));
    expect(cell.status).toBe('unassigned');
    expect(cell.label).toBe('Chưa phân công');
    expect(cell.tone).toBe('warning');
  });

  it('maps a vehicle + placeholder-only device to the info Đã giao xe cell', () => {
    const cell = toDriverStatusCell(row({ assignedVehicle: vehicle, devices: [device('0.0.0')] }));
    expect(cell.status).toBe('assigned');
    expect(cell.label).toBe('Đã giao xe');
    expect(cell.tone).toBe('info');
  });

  it('maps a vehicle + live device to the success Đang hoạt động cell', () => {
    const cell = toDriverStatusCell(row({ assignedVehicle: vehicle, devices: [device('1.4.0')] }));
    expect(cell.status).toBe('active');
    expect(cell.label).toBe('Đang hoạt động');
    expect(cell.tone).toBe('success');
  });
});

describe('partitionDriversByStatus', () => {
  it('buckets each driver exactly once by status (partition, never copy)', () => {
    const rows = [
      row({ driverId: 'a', assignedVehicle: null }),
      row({ driverId: 'b', assignedVehicle: vehicle, devices: [device('0.0.0')] }),
      row({ driverId: 'c', assignedVehicle: vehicle, devices: [device('1.4.0')] }),
      row({ driverId: 'd', assignedVehicle: vehicle, devices: [device('1.4.0')] }),
    ];
    const p = partitionDriversByStatus(rows);
    expect(p.unassigned.map((r) => r.driverId)).toEqual(['a']);
    expect(p.assigned.map((r) => r.driverId)).toEqual(['b']);
    expect(p.active.map((r) => r.driverId)).toEqual(['c', 'd']);
    const total = p.unassigned.length + p.assigned.length + p.active.length;
    expect(total).toBe(rows.length);
  });

  it('returns three empty buckets for no drivers', () => {
    const p = partitionDriversByStatus([]);
    expect(p).toEqual({ unassigned: [], assigned: [], active: [] });
  });
});
