// apps/api/test/driver-assignments.enriched.test.ts
// TDD RED: assignments include human-readable order ref, customer, plate, pickup, delivery.
import { describe, it, expect, vi } from 'vitest';
import { DriverAssignmentsController } from '../src/dispatch/driver-assignments.controller.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const op: OperatorContext = Object.freeze({
  operatorId: '00000000-0000-0000-0000-0000000000aa',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000000',
  depotId: '00000000-0000-0000-0000-000000000000',
  legalEntityId: '00000000-0000-0000-0000-000000000000',
});

function makeDb(rows: readonly Record<string, unknown>[]): {
  select: ReturnType<typeof vi.fn>;
  _chain: {
    from: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
} {
  const chain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { select: vi.fn().mockReturnValue(chain), _chain: chain };
}

describe('DriverAssignmentsController (enriched)', () => {
  it('returns enriched fields: orderRef, customerName, plate, pickup, delivery', async () => {
    const db = makeDb([
      {
        roadRunId: 'r1',
        state: 'dispatched',
        plannedStartAt: new Date('2026-05-10T08:00:00Z'),
        startedAt: null,
        completedAt: null,
        plate: '62H-12345',
        orderRef: 'XT.001',
        customerName: 'ABC Logistics',
        pickupName: 'Kho A',
        deliveryName: 'Kho B',
      },
    ]);
    const controller = new DriverAssignmentsController(db as never);
    const res = await controller.getAssignments(op);
    expect(res.rows[0]).toMatchObject({
      roadRunId: 'r1',
      state: 'dispatched',
      plate: '62H-12345',
      orderRef: 'XT.001',
      customerName: 'ABC Logistics',
      pickupName: 'Kho A',
      deliveryName: 'Kho B',
    });
  });

  it('handles missing optional fields as null', async () => {
    const db = makeDb([
      {
        roadRunId: 'r2',
        state: 'planned',
        plannedStartAt: null,
        startedAt: null,
        completedAt: null,
        plate: null,
        orderRef: null,
        customerName: null,
        pickupName: null,
        deliveryName: null,
      },
    ]);
    const controller = new DriverAssignmentsController(db as never);
    const res = await controller.getAssignments(op);
    expect(res.rows[0]?.plate).toBeNull();
    expect(res.rows[0]?.orderRef).toBeNull();
    expect(res.rows[0]?.customerName).toBeNull();
    expect(res.rows[0]?.pickupName).toBeNull();
    expect(res.rows[0]?.deliveryName).toBeNull();
  });
});
