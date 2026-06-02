// apps/ops-web/test/admin-drivers-state.test.ts
import { describe, it, expect } from 'vitest';
import { reduceAdminDriversState, type AdminDriversState } from '../src/features/admin/drivers-state.js';

describe('reduceAdminDriversState', () => {
  it('starts in loading state', () => {
    const s: AdminDriversState = { kind: 'loading' };
    expect(s.kind).toBe('loading');
  });

  it('transitions to loaded with rows', () => {
    const next = reduceAdminDriversState({ kind: 'loading' }, {
      type: 'loaded',
      rows: [{ driverId: 'd1', fullName: 'A', phone: null, operatorId: null, assignedVehicle: null, assignmentId: null, devices: [] }],
    });
    expect(next.kind).toBe('loaded');
    if (next.kind === 'loaded') expect(next.rows).toHaveLength(1);
  });

  it('transitions to error', () => {
    const next = reduceAdminDriversState({ kind: 'loading' }, { type: 'error', message: 'boom' });
    expect(next.kind).toBe('error');
    if (next.kind === 'error') expect(next.message).toBe('boom');
  });

  it("transitions back to loading on reset (line 44)", () => {
    const loaded: AdminDriversState = { kind: "loaded", rows: [] };
    const next = reduceAdminDriversState(loaded, { type: "reset" });
    expect(next.kind).toBe("loading");
  });
});
