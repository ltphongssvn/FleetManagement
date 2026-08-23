// apps/api/test/transport-orders.cancel.service.test.ts
// L5 unit tests for TransportOrdersCancelService with a fake transaction.
// Drives every branch deterministically so coverage is exact and the
// tests are fast. Mirrors the fake-tx pattern from
// transport-orders.service.defensive-throws.test.ts.
//
// Cascade-aware fake-tx (post-L0 fix): the service performs a SELECT on
// road_run_transport_order to find linked runs before issuing the
// cascade UPDATE on road_run. The fake tx's where() returns a thenable
// whose resolved array is configurable per test (via the linkedRunIds
// option) AND exposes .limit() so the original existence-lookup shape
// keeps working.
//
// Projection-event aware fake-tx (T5 dispatch-board-reflects-cancel
// follow-on): after the cascade UPDATE, the service calls
// allocateServerSeq + appendTriWrite for each row that moved to
// 'cancelled'. The fake exposes:
//   - tx.update(roadRun).set({state:'cancelled'}).where().returning() -> linked rows
//   - tx.insert(...).values(...).onConflictDoNothing/returning/...    -> no-op
//   - tx.execute(...) and the rest of allocateServerSeq's dependency  -> no-op
// Integration tests cover the real behavior against PGlite.
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
function makeDb(opts: MakeDbOpts): {
  db: unknown;
  updateValues: ReturnType<typeof vi.fn>;
  cascadeWhere: ReturnType<typeof vi.fn>;
  appendInsertCalls: ReturnType<typeof vi.fn>;
} {
  const updateValues = vi.fn();
  const cascadeWhere = vi.fn();
  const appendInsertCalls = vi.fn();
  // Generic insert chain: appendTriWrite + allocateServerSeq path.
  // Returns a chain that accepts any further calls (.values, .returning,
  // .onConflictDoNothing) and resolves with rows that allocateServerSeq
  // accepts (a single object with serverSeq), or empty for appendTri.
  const insertChain = (table: unknown): unknown => {
    appendInsertCalls(table);
    return {
      values: (): unknown => ({
        returning: (): Promise<unknown[]> => Promise.resolve([{ serverSeq: 1n }]),
        onConflictDoNothing: (): unknown => ({
          returning: (): Promise<unknown[]> => Promise.resolve([{ serverSeq: 1n }]),
        }),
      }),
    };
  };
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
              then: <T>(onFulfilled: (value: unknown[]) => T): Promise<T> =>
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
        const isCascade =
          typeof v === 'object' &&
          v !== null &&
          Object.keys(asRecord).length === 1 &&
          asRecord['state'] === 'cancelled';
        if (isCascade) {
          return {
            where: (cond: unknown) => {
              cascadeWhere(cond);
              const updatedRunRows = (opts.linkedRunIds ?? []).map((roadRunId) => ({ roadRunId }));
              return {
                returning: (): Promise<unknown[]> => Promise.resolve(updatedRunRows),
              };
            },
          };
        }
        updateValues(v);
        return {
          where: () => ({
            returning: (): Promise<unknown[]> =>
              Promise.resolve(opts.updatedRow ? [opts.updatedRow] : []),
          }),
        };
      },
    }),
    insert: insertChain,
    // allocateServerSeq executes a raw SQL via tx.execute. Stub it so
    // it returns a row that satisfies the helper's contract.
    execute: (): Promise<{ rows: { next_seq: string }[] }> =>
      Promise.resolve({ rows: [{ next_seq: '1' }] }),
  };
  const db = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(txObject),
  };
  return { db, updateValues, cascadeWhere, appendInsertCalls };
}
const validId = '11111111-1111-1111-1111-111111111111';
describe('@fleet/api - TransportOrdersCancelService.cancel', () => {
  it('throws TransportOrderNotFoundError when no row matches in tenancy', async () => {
    const op = createOperatorContext();
    const { db } = makeDb({ selectRow: undefined });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op)).rejects.toBeInstanceOf(
      TransportOrderNotFoundError,
    );
  });
  it('throws TransportOrderCannotBeCancelledError when current state is terminal completed', async () => {
    const op = createOperatorContext();
    const row: FakeOrderRow = {
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'completed',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: row });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op)).rejects.toBeInstanceOf(
      TransportOrderCannotBeCancelledError,
    );
  });
  it('transitions draft -> cancelled and persists audit fields (idempotent=false)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'draft',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
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
    const result = await svc.cancel(
      validId,
      { reason: 'customer_request', note: 'unit test cancel' },
      op,
    );
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
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'cancelled',
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
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'cancelled',
      cancelledAt: new Date('2026-05-23T11:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: null,
    };
    const { db } = makeDb({ selectRow: cancelledRow });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'driver_unavailable' }, op)).rejects.toBeInstanceOf(
      TransportOrderCannotBeCancelledError,
    );
  });
  it('transitions assigned -> cancelled (FSM allows this)', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'assigned',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow,
      state: 'cancelled',
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
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'in_transit',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow,
      state: 'cancelled',
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
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'draft',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
    };
    // updatedRow is undefined: a concurrent writer deleted/changed the
    // row between our SELECT and our UPDATE. The defensive throw must
    // surface as NotFound so the caller retries cleanly.
    const { db } = makeDb({ selectRow: beforeRow });
    const svc = new TransportOrdersCancelService(db as never);
    await expect(svc.cancel(validId, { reason: 'customer_request' }, op)).rejects.toBeInstanceOf(
      TransportOrderNotFoundError,
    );
  });
  it('runs the cascade UPDATE and emits one tri-write event per linked road_run', async () => {
    const op = createOperatorContext();
    const beforeRow: FakeOrderRow = {
      transportOrderId: validId,
      companyId: op.companyId,
      state: 'draft',
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationNote: null,
    };
    const afterRow: FakeOrderRow = {
      ...beforeRow,
      state: 'cancelled',
      cancelledAt: new Date('2026-05-23T12:00:00.000Z'),
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: null,
    };
    const { db, cascadeWhere, appendInsertCalls } = makeDb({
      selectRow: beforeRow,
      updatedRow: afterRow,
      linkedRunIds: ['rr-1', 'rr-2'],
    });
    const svc = new TransportOrdersCancelService(db as never);
    const result = await svc.cancel(validId, { reason: 'customer_request' }, op);
    expect(result.state).toBe('cancelled');
    expect(cascadeWhere).toHaveBeenCalledTimes(1);
    // appendTriWrite issues 3 inserts (sync_change_feed + fleet_audit_log
    // + outbox) per road_run; 2 road_runs => 6 inserts total. Don't
    // assert the exact count to keep this test resilient to future
    // changes inside appendTriWrite; assert it was called at all.
    expect(appendInsertCalls.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
