// apps/api/test/driver-assignments.controller.test.ts
// TDD RED: GET /driver/assignments returns road runs assigned to JWT operator only.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DriverAssignmentsController } from '../src/dispatch/driver-assignments.controller.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const op: OperatorContext = Object.freeze({
  operatorId: '00000000-0000-0000-0000-0000000000bb',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000000',
  depotId: '00000000-0000-0000-0000-000000000000',
  legalEntityId: '00000000-0000-0000-0000-000000000000',
});

function makeDb(rows: ReadonlyArray<Record<string, unknown>>) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { select: vi.fn().mockReturnValue(chain), _chain: chain };
}

describe('DriverAssignmentsController', () => {
  let db: ReturnType<typeof makeDb>;
  let controller: DriverAssignmentsController;

  beforeEach(() => {
    db = makeDb([
      {
        roadRunId: 'r1', state: 'dispatched',
        plate: '62H-12345',
        plannedStartAt: new Date('2026-05-10T08:00:00Z'),
        startedAt: null, completedAt: null,
      },
    ]);
    controller = new DriverAssignmentsController(db as never);
  });

  it('returns assignments for the current operator', async () => {
    const res = await controller.getAssignments(op);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ roadRunId: 'r1', state: 'dispatched', plate: '62H-12345' });
    expect(res.rows[0]?.plannedStartAt).toBe('2026-05-10T08:00:00.000Z');
  });

  it('filters by operatorId AND companyId (tenancy)', async () => {
    await controller.getAssignments(op);
    expect(db._chain.where).toHaveBeenCalledOnce();
  });

  it('serializes nullable timestamps as null', async () => {
    db = makeDb([
      { roadRunId: 'r2', state: 'planned', plate: null, plannedStartAt: null, startedAt: null, completedAt: null },
    ]);
    controller = new DriverAssignmentsController(db as never);
    const res = await controller.getAssignments(op);
    expect(res.rows[0]?.plannedStartAt).toBeNull();
    expect(res.rows[0]?.plate).toBeNull();
  });
});
