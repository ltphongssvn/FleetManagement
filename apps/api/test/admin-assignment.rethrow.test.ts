// apps/api/test/admin-assignment.rethrow.test.ts
// Covers the catch fall-through in AdminAssignmentService.assign(): a caught
// error that is NOT a unique-violation on either partial index must propagate
// unchanged (not be swallowed or mis-mapped to a 409). Pure unit test with a
// fake db whose insert chain rejects with a generic error -- no testcontainer.
import { describe, it, expect } from 'vitest';
import { AdminAssignmentService } from '../src/admin/admin-assignment.service.js';

const TENANCY = {
  driverId: '00000000-0000-0000-0000-0000000000d1',
  vehicleId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};

// Minimal fake FleetDb: update() resolves (the operator_id backfill), insert()
// rejects at .returning() with a generic (non-23505) error. The reason is typed
// Error so @typescript-eslint/prefer-promise-reject-errors is satisfied
// statically; the test still asserts identity, not shape.
function makeThrowingDb(err: Error): unknown {
  return {
    update() {
      return { set() { return { where() { return Promise.resolve(); } }; } };
    },
    insert() {
      return { values() { return { returning() { return Promise.reject(err); } }; } };
    },
  };
}

describe('@fleet/api - AdminAssignmentService.assign re-throws non-unique errors', () => {
  it('propagates a generic insert error unchanged', async () => {
    const boom = new Error('connection reset');
    const svc = new AdminAssignmentService(makeThrowingDb(boom) as never);
    await expect(svc.assign(TENANCY)).rejects.toBe(boom);
  });
});
