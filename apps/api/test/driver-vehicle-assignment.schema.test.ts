// apps/api/test/driver-vehicle-assignment.schema.test.ts
// RED: schema for 1:1 driver↔vehicle binding with soft-revoke.
import { describe, it, expect } from 'vitest';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';

describe('driver_vehicle_assignment schema', () => {
  it('exposes assignmentId, driverId, vehicleId, assignedAt, revokedAt columns', () => {
    const cols = Object.keys(driverVehicleAssignment);
    expect(cols).toContain('assignmentId');
    expect(cols).toContain('driverId');
    expect(cols).toContain('vehicleId');
    expect(cols).toContain('assignedAt');
    expect(cols).toContain('revokedAt');
  });

  it('inherits tenancy columns (companyId, businessUnitId, depotId, legalEntityId)', () => {
    const cols = Object.keys(driverVehicleAssignment);
    expect(cols).toContain('companyId');
    expect(cols).toContain('businessUnitId');
    expect(cols).toContain('depotId');
    expect(cols).toContain('legalEntityId');
  });
});
