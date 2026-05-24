// apps/api/test/transport-orders.cancel.service.test.ts
// L5 RED for T5: TransportOrdersCancelService unit tests with a fake
// transaction. Drives every branch deterministically so coverage is exact
// and the tests are fast. Mirrors the fake-tx pattern from
// transport-orders.service.defensive-throws.test.ts.
//
// Cascade-aware fake-tx (post-L0 fix): the service now performs a second
// SELECT on road_run_transport_order to find linked runs before issuing
// the cascade UPDATE on road_run. The fake tx's where() returns a
// thenable whose resolved array is configurable per test (via the
// linkedRunIds option) AND exposes .limit() so the original
// existence-lookup shape keeps working. Integration tests cover the
// real cascade against PGlite.
import { describe, it, expect, vi } from 'vitest';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import {
  TransportOrderNotFoundError,
  TransportOrderCannotBeCancelledError,
} from '../src/transport-orders/transport-orders.errors.js';
import { createOperatorContext } from '@fleet/test-fixtures';
interface FakeOrderRow {
  transportOrderId: string;
  companyId: string;
  state: 'draft' | 'assigned' | 'in_transit' | 'completed' | 'cancelled';
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  cancellationNote: string | null;
}
interface MakeDbOpts {
  selectRow: FakeOrderRow | undefined;
  updatedRow?: FakeOrderRow | undefined;
  linkedRunIds?: readonly string[];
}
function makeDb(opts: MakeDbOpts): { db: unknown; updateValues: ReturnType<typeof vi.fn>; cascadeWhere: ReturnType<typeof vi.fn> } {
  const updateValues = vi.fn();
  const cascadeWhere = vi.fn();
  const txObject = {
    select: () => ({
      from: () => {
        const limitable = {
          limit: (): Promise<unknown[]> => Promise.resolve(opts.selectRow ? [opts.selectRow] : []),
        };
        return {
          where: () => {
            const rows = (opts.linkedRunIds ?? []).map((roadRunId) => ({ roadRunId }));
            const thenable = {
              ...limitable,
              then: <T,>(onFulfilled: (value: unknown[]) => T): Promise<T> =>
                Promise.resolve(rows).then(onFulfilled),
            };
            return thenable;
          },
        };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        const asRecord = v as Record<string, unknown>;
        const isCascade = typeof v === 'object' && v !== null
          && Object.keys(asRecord).length === 1
          && asRecord['state'] === 'cancelled';
        if (isCascade) {
          return {
            where: (cond: unknown): Promise<unknown[]> => {
              cascadeWhere(cond);
              return Promise.resolve([]);
            },
          };
        }
        updateValues(v);
        return {
          where: () => ({
            returning: (): Promise<unknown[]> => Promise.resolve(opts.updatedRow ? [opts.updatedRow] : []),
          }),
        };
      },
    }),
  };
  const db = {
    transaction: async <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(txObject),
  };
  return { db, updateValues, cascadeWhere };
}
const validId = '11111111-1111-1111-1111-111111111111';
describe('@fleet/api - TransportOrdersCancelService.cancel', () => {
  it('throws TransportOrderNotFoundError when no row matches in tenancy', async () => {
    const op = createOperatorContext();
    const { db } = makeDb({ selectRow: undefined });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op))
      .rejects.toBeInstanceOf(TransportOrderNotFoundError);
  });
  it('throws TransportOrderCannotBeCancelledError when current state is terminal completed', async () => {
    const op = createOperatorContext();
    const row: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'completed',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: row });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op))
      .rejects.toBeInstanceOf(TransportOrderCannotBeCancelledError);
  });
  it('transitions draft -> cancelled and persists audit fields (idempotent=false)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'draft',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow,
      state: 'cancelled',
      cancelledAt: new Date('2026-05-23T12:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: 'unit test cancel',
    };
    const { db, updateValues } = makeDb({ selectRow: beforeRow, updatedRow: afterRow });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'customer_request', note: 'unit test cancel' }, op);
    expect(result.state).toBe('cancelled');
    expect(result.cancellationReason).toBe('customer_request');
    expect(result.cancellationNote).toBe('unit test cancel');
    expect(result.cancelledBy).toBe(op.operatorId);
    expect(result.idempotent).toBe(false);
    expect(updateValues).toHaveBeenCalledTimes(1);
    const setArg = updateValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg['state']).toBe('cancelled');
    expect(setArg['cancellationReason']).toBe('customer_request');
    expect(setArg['cancellationNote']).toBe('unit test cancel');
    expect(setArg['cancelledBy']).toBe(op.operatorId);
    expect(setArg['cancelledAt']).toBeInstanceOf(Date);
  });
  it('is idempotent when state is already cancelled with the SAME reason (idempotent=true)', async () => {
    const op = createOperatorContext();
    const cancelledRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'cancelled',
      cancelledAt: new Date('2026-05-23T11:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: 'first cancel',
    };
    const { db, updateValues } = makeDb({ selectRow: cancelledRow });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'customer_request', note: 'retry' }, op);
    expect(result.idempotent).toBe(true);
    expect(result.cancellationReason).toBe('customer_request');
    expect(result.cancellationNote).toBe('first cancel');
    expect(updateValues).not.toHaveBeenCalled();
  });
  it('throws CannotBeCancelledError when already cancelled with a DIFFERENT reason', async () => {
    const op = createOperatorContext();
    const cancelledRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'cancelled',
      cancelledAt: new Date('2026-05-23T11:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: cancelledRow });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'driver_unavailable' }, op))
      .rejects.toBeInstanceOf(TransportOrderCannotBeCancelledError);
  });
  it('transitions assigned -> cancelled (FSM allows this)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'assigned',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow, state: 'cancelled',
      cancelledAt: new Date('2026-05-23T12:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'weather',
      cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: beforeRow, updatedRow: afterRow });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'weather' }, op);
    expect(result.state).toBe('cancelled');
    expect(result.idempotent).toBe(false);
    expect(result.cancellationNote).toBeNull();
  });
  it('transitions in_transit -> cancelled (FSM allows this)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'in_transit',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow, state: 'cancelled',
      cancelledAt: new Date('2026-05-23T12:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'vehicle_breakdown',
      cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: beforeRow, updatedRow: afterRow });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'vehicle_breakdown' }, op);
    expect(result.state).toBe('cancelled');
  });
  it('throws TransportOrderNotFoundError when the UPDATE ... RETURNING comes back empty (concurrent-writer race)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'draft',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    // updatedRow is undefined: a concurrent writer deleted/changed the
    // row between our SELECT and our UPDATE. The defensive throw must
    // surface as NotFound so the caller retries cleanly.
    const { db } = makeDb({ selectRow: beforeRow });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op))
      .rejects.toBeInstanceOf(TransportOrderNotFoundError);
  });
  it('runs the cascade UPDATE when at least one linked road_run exists', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId, companyId: op.companyId, state: 'draft',
      cancelledAt: null, cancelledBy: null, cancellationReason: null, cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow, state: 'cancelled',
      cancelledAt: new Date('2026-05-23T12:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: null,
    };
    const { db, cascadeWhere } = makeDb({
      selectRow: beforeRow,
      updatedRow: afterRow,
      linkedRunIds: ['rr-1', 'rr-2'],
    });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'customer_request' }, op);
    expect(result.state).toBe('cancelled');
    expect(cascadeWhere).toHaveBeenCalledTimes(1);
  });

});
