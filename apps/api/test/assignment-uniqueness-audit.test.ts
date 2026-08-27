// apps/api/test/assignment-uniqueness-audit.test.ts
// RED-first spec for the driver-vehicle assignment-pair uniqueness classifier.
// The schema declares a 1:1 invariant via two partial-unique indexes; this
// pure classifier detects any active-row violation (duplicate active vehicle
// per driver, duplicate active driver per vehicle, or a fully duplicated pair).
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { auditAssignmentUniqueness } from '../src/admin/assignment-uniqueness-audit.js';

const CO = randomUUID();

describe('auditAssignmentUniqueness', () => {
  it('reports a clean bill for a valid 1:1 fleet', () => {
    const rows = [
      {
        assignmentId: randomUUID(),
        companyId: CO,
        driverId: randomUUID(),
        vehicleId: randomUUID(),
      },
      {
        assignmentId: randomUUID(),
        companyId: CO,
        driverId: randomUUID(),
        vehicleId: randomUUID(),
      },
    ];
    const r = auditAssignmentUniqueness(rows);
    expect(r.isClean).toBe(true);
    expect(r.totalActiveAssignments).toBe(2);
    expect(r.duplicateDriverGroups).toHaveLength(0);
    expect(r.duplicateVehicleGroups).toHaveLength(0);
    expect(r.duplicatePairGroups).toHaveLength(0);
  });

  it('detects two active vehicles assigned to one driver', () => {
    const driverId = randomUUID();
    const rows = [
      { assignmentId: randomUUID(), companyId: CO, driverId, vehicleId: randomUUID() },
      { assignmentId: randomUUID(), companyId: CO, driverId, vehicleId: randomUUID() },
    ];
    const r = auditAssignmentUniqueness(rows);
    expect(r.isClean).toBe(false);
    expect(r.duplicateDriverGroups).toHaveLength(1);
    const [dg] = r.duplicateDriverGroups;
    if (dg === undefined) throw new Error('expected a driver group');
    expect(dg.driverId).toBe(driverId);
    expect(dg.assignmentIds).toHaveLength(2);
    expect(r.duplicateVehicleGroups).toHaveLength(0);
  });

  it('detects two active drivers assigned to one vehicle', () => {
    const vehicleId = randomUUID();
    const rows = [
      { assignmentId: randomUUID(), companyId: CO, driverId: randomUUID(), vehicleId },
      { assignmentId: randomUUID(), companyId: CO, driverId: randomUUID(), vehicleId },
    ];
    const r = auditAssignmentUniqueness(rows);
    expect(r.isClean).toBe(false);
    expect(r.duplicateVehicleGroups).toHaveLength(1);
    const [vg] = r.duplicateVehicleGroups;
    if (vg === undefined) throw new Error('expected a vehicle group');
    expect(vg.vehicleId).toBe(vehicleId);
    expect(vg.assignmentIds).toHaveLength(2);
    expect(r.duplicateDriverGroups).toHaveLength(0);
  });

  it('detects a fully duplicated driver-vehicle pair', () => {
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const rows = [
      { assignmentId: randomUUID(), companyId: CO, driverId, vehicleId },
      { assignmentId: randomUUID(), companyId: CO, driverId, vehicleId },
    ];
    const r = auditAssignmentUniqueness(rows);
    expect(r.isClean).toBe(false);
    expect(r.duplicatePairGroups).toHaveLength(1);
    const [pg] = r.duplicatePairGroups;
    if (pg === undefined) throw new Error('expected a pair group');
    expect(pg.driverId).toBe(driverId);
    expect(pg.vehicleId).toBe(vehicleId);
    expect(pg.assignmentIds).toHaveLength(2);
    expect(r.duplicateDriverGroups).toHaveLength(1);
    expect(r.duplicateVehicleGroups).toHaveLength(1);
  });

  it('does not flag the same driver in different companies', () => {
    const driverId = randomUUID();
    const rows = [
      { assignmentId: randomUUID(), companyId: randomUUID(), driverId, vehicleId: randomUUID() },
      { assignmentId: randomUUID(), companyId: randomUUID(), driverId, vehicleId: randomUUID() },
    ];
    const r = auditAssignmentUniqueness(rows);
    expect(r.isClean).toBe(true);
  });
});
