// apps/api/test/driver-delivery.service.test.ts
// TDD: driver delivery lifecycle. The driver accepts an assigned
// road_run (planned->dispatched), starts the run (dispatched->started),
// and completes delivery (started->completed). Each transition is
// FSM-validated via transitionRoadRun, operator-ownership-scoped, and
// recorded through the same tri-write/projection path as creation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const appendTriWriteMock = vi.fn(() => Promise.resolve({ duplicate: false }));
const allocateServerSeqMock = vi.fn(() => Promise.resolve(42n));
vi.mock('../src/database/append-tri-write.js', () => ({ appendTriWrite: appendTriWriteMock }));
vi.mock('../src/database/server-seq.repository.js', () => ({
  allocateServerSeq: allocateServerSeqMock,
}));

const { DriverDeliveryService } = await import('../src/dispatch/driver-delivery.service.js');

const op = {
  operatorId: 'op-1',
  companyId: 'co-1',
  businessUnitId: 'bu-1',
  depotId: 'dp-1',
  legalEntityId: 'le-1',
} as never;

function dbWithRoadRun(state: string | null): never {
  const rrRow =
    state === null
      ? []
      : [{ roadRunId: 'rr-1', state, companyId: 'co-1', assignedOperatorId: 'op-1' }];
  // The rr ownership lookup uses .from().where().limit() -> rrRow.
  // The completion guard (assertAllManifestsCommitted) uses .from().where()
  // WITHOUT .limit(), awaiting an array of rows. We make where() BOTH awaitable
  // (resolves [] => zero linked orders => guard is trivially satisfied, so this
  // unit test stays focused on FSM + ownership + tri-write; the manifest-count
  // gate is covered by driver-delivery.complete-requires-manifests.integration)
  // AND still expose .limit() for the rr lookup.
  const whereResult: { limit: (n: number) => Promise<readonly unknown[]> } & PromiseLike<
    readonly unknown[]
  > = {
    limit: () => Promise.resolve(rrRow),
    then: <R>(
      onfulfilled?: ((value: readonly unknown[]) => R | PromiseLike<R>) | null,
    ): PromiseLike<R> => Promise.resolve([] as readonly unknown[]).then(onfulfilled),
  };
  const selChain = { from: () => ({ where: () => whereResult }) };
  const updChain = { set: () => ({ where: () => Promise.resolve(undefined) }) };
  return {
    transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => selChain,
        update: () => updChain,
      }),
  } as never;
}

function lastTriWrite(): { eventType: string; aggregateId: string } {
  const call = appendTriWriteMock.mock.calls[0] as unknown as unknown[] | undefined;
  if (call === undefined) throw new Error('appendTriWrite was not called');
  return call[1] as { eventType: string; aggregateId: string };
}

describe('@fleet/api - DriverDeliveryService', () => {
  beforeEach(() => {
    appendTriWriteMock.mockClear();
    allocateServerSeqMock.mockClear();
  });

  it('accept: planned -> dispatched, tri-writes road_run.dispatched', async () => {
    const svc = new DriverDeliveryService(dbWithRoadRun('planned'));
    const res = await svc.accept('rr-1', op);
    expect(res.state).toBe('dispatched');
    expect(appendTriWriteMock).toHaveBeenCalledTimes(1);
    const params = lastTriWrite();
    expect(params.eventType).toBe('road_run.dispatched');
    expect(params.aggregateId).toBe('rr-1');
  });

  it('start: dispatched -> started', async () => {
    const svc = new DriverDeliveryService(dbWithRoadRun('dispatched'));
    const res = await svc.start('rr-1', op);
    expect(res.state).toBe('started');
    expect(lastTriWrite().eventType).toBe('road_run.started');
  });

  it('complete: started -> completed', async () => {
    const svc = new DriverDeliveryService(dbWithRoadRun('started'));
    const res = await svc.complete('rr-1', op);
    expect(res.state).toBe('completed');
    expect(lastTriWrite().eventType).toBe('road_run.completed');
  });

  it('rejects an illegal transition (planned -> completed)', async () => {
    const svc = new DriverDeliveryService(dbWithRoadRun('planned'));
    // Contract change (forgiving-FSM arc): rejection is now a structured 409
    // with Vietnamese copy; the structured shape is pinned in
    // driver-delivery.structured-errors.test.ts.
    await expect(svc.complete('rr-1', op)).rejects.toThrow(/Không thể/);
    expect(appendTriWriteMock).not.toHaveBeenCalled();
  });

  it('rejects when the road_run is not found / not owned by the operator', async () => {
    const svc = new DriverDeliveryService(dbWithRoadRun(null));
    await expect(svc.accept('rr-x', op)).rejects.toThrow(/not found|not owned|404/i);
    expect(appendTriWriteMock).not.toHaveBeenCalled();
  });
});
