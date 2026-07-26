// apps/ops-web/test/driver-attention-machine.test.ts
// RED-first for the driver-attention triage machine (XState v5, pure logic,
// no DOM). 2026 discipline: test the transitions, not the UI -- createActor,
// send events, assert snapshot value + context. The machine models WORKFLOW
// state only; rows are server data validated once at the HTTP boundary
// (parseAdminDriverRows) and trusted here (two-axis rule). Partition is
// delegated to classifyDriverAttention from @fleet/sync-protocol so the
// contract stays the single classification truth.
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { driverAttentionMachine } from '@/features/admin/driver-attention.machine';

const DEVICE = {
  deviceId: 'dev-1',
  platform: 'ios',
  appVersion: '1.4.0',
  lastSeenAt: null,
};
function row(overrides: Partial<AdminDriverRow>): AdminDriverRow {
  return {
    driverId: 'drv-1',
    fullName: 'Nguyen Van A',
    phone: '+84901000001',
    operatorId: 'op-1',
    assignedVehicle: { vehicleId: 'veh-1', plate: '51C-123.45' },
    assignmentId: 'asg-1',
    devices: [DEVICE],
    ...overrides,
  };
}
const COMPLETE = row({ driverId: 'drv-ok' });
const NO_VEHICLE = row({ driverId: 'drv-nv', assignedVehicle: null, assignmentId: null });
const NO_DEVICE = row({ driverId: 'drv-nd', devices: [] });
const NEITHER = row({ driverId: 'drv-nn', assignedVehicle: null, assignmentId: null, devices: [] });

describe('driverAttentionMachine', () => {
  it('starts in loading with an empty partition', () => {
    const actor = createActor(driverAttentionMachine).start();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.attention).toEqual([]);
    expect(snap.context.configured).toEqual([]);
    expect(snap.context.errorMessage).toBeNull();
  });

  it('LOADED with gaps lands in ready.attention with a classified partition', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'LOADED', rows: [COMPLETE, NO_VEHICLE, NO_DEVICE, NEITHER] });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: 'attention' })).toBe(true);
    expect(snap.context.attention.map((e) => e.row.driverId)).toEqual(['drv-nv', 'drv-nd', 'drv-nn']);
    expect(snap.context.configured.map((r) => r.driverId)).toEqual(['drv-ok']);
  });

  it('attention entries carry reason codes in stable contract order', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'LOADED', rows: [NEITHER, NO_DEVICE, NO_VEHICLE] });
    const byId = new Map(
      actor.getSnapshot().context.attention.map((e) => [e.row.driverId, e.reasons]),
    );
    expect(byId.get('drv-nn')).toEqual(['VEHICLE_UNASSIGNED', 'DEVICE_UNREGISTERED']);
    expect(byId.get('drv-nd')).toEqual(['DEVICE_UNREGISTERED']);
    expect(byId.get('drv-nv')).toEqual(['VEHICLE_UNASSIGNED']);
  });

  it('LOADED with only complete rows lands in ready.allClear', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'LOADED', rows: [COMPLETE, row({ driverId: 'drv-ok-2' })] });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: 'allClear' })).toBe(true);
    expect(snap.context.attention).toEqual([]);
    expect(snap.context.configured).toHaveLength(2);
  });

  it('LOADED with zero rows lands in ready.allClear', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'LOADED', rows: [] });
    expect(actor.getSnapshot().matches({ ready: 'allClear' })).toBe(true);
  });

  it('ERROR lands in error with the message, partition untouched', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'ERROR', message: 'load failed' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('error');
    expect(snap.context.errorMessage).toBe('load failed');
    expect(snap.context.attention).toEqual([]);
  });

  it('REFRESH returns to loading and clears the error', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'ERROR', message: 'boom' });
    actor.send({ type: 'REFRESH' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.errorMessage).toBeNull();
  });

  it('a full reload cycle re-partitions from the new rows', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'LOADED', rows: [NO_VEHICLE] });
    expect(actor.getSnapshot().matches({ ready: 'attention' })).toBe(true);
    actor.send({ type: 'REFRESH' });
    expect(actor.getSnapshot().value).toBe('loading');
    actor.send({ type: 'LOADED', rows: [COMPLETE] });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: 'allClear' })).toBe(true);
    expect(snap.context.attention).toEqual([]);
    expect(snap.context.configured.map((r) => r.driverId)).toEqual(['drv-ok']);
  });

  it('LOADED while in error recovers into a ready state', () => {
    const actor = createActor(driverAttentionMachine).start();
    actor.send({ type: 'ERROR', message: 'first try failed' });
    actor.send({ type: 'LOADED', rows: [NO_DEVICE] });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: 'attention' })).toBe(true);
    expect(snap.context.errorMessage).toBeNull();
  });
});
