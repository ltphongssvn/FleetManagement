// apps/api/test/admin-assignment.controller.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminAssignmentController } from '../src/admin/admin-assignment.controller.js';
import type { AdminAssignmentService } from '../src/admin/admin-assignment.service.js';
import type { OperatorContext } from '@fleet/domain';

describe('AdminAssignmentController', () => {
  let assignFn: ReturnType<typeof vi.fn>;
  let revokeFn: ReturnType<typeof vi.fn>;
  let controller: AdminAssignmentController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  beforeEach(() => {
    assignFn = vi.fn();
    revokeFn = vi.fn();
    controller = new AdminAssignmentController({ assign: assignFn, revoke: revokeFn } as unknown as AdminAssignmentService);
  });

  it('POST /admin/driver-vehicle-assignments creates assignment', async () => {
    assignFn.mockResolvedValue({ assignmentId: 'a1', driverId: '55555555-5555-5555-5555-555555555555', vehicleId: '66666666-6666-6666-6666-666666666666' });
    const r = await controller.create(op, { driverId: '55555555-5555-5555-5555-555555555555', vehicleId: '66666666-6666-6666-6666-666666666666' });
    expect(r.assignmentId).toBe('a1');
    expect(assignFn).toHaveBeenCalledWith(expect.objectContaining({ driverId: '55555555-5555-5555-5555-555555555555', vehicleId: '66666666-6666-6666-6666-666666666666', companyId: op.companyId }));
  });

  it('DELETE /admin/driver-vehicle-assignments/:id revokes', async () => {
    revokeFn.mockResolvedValue({ assignmentId: 'a1', revokedAt: new Date(), revocationReason: 'driver_left' });
    const r = await controller.revoke('a1', { reason: 'driver_left' });
    expect(r.revokedAt).not.toBeNull();
    expect(revokeFn).toHaveBeenCalledWith({ assignmentId: 'a1', reason: 'driver_left' });
  });
});
