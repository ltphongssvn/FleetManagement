// apps/api/test/projection-runner.service.unit.test.ts
// Unit tests for ProjectionRunnerService — kill Stryker mutants by mocking
// drizzle chain (insert/execute/select/update/delete), schema markers, and
// the applyDispatchBoardEvent policy.
//
// SOFT DELETE: a tombstone now yields a 'soft_delete' decision which the runner applies
// as an UPDATE setting deleted_at (the app role holds no DELETE privilege), NOT a physical
// delete. These tests assert the UPDATE path + that current-row reads filter deleted_at.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApplyDispatchBoardEvent } = vi.hoisted(() => ({
  mockApplyDispatchBoardEvent: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  and: (...preds: unknown[]) => ({ _kind: 'and', preds }),
  gt: (col: unknown, value: unknown) => ({ _kind: 'gt', col, value }),
  isNull: (col: unknown) => ({ _kind: 'isNull', col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _kind: 'sql',
    raw: strings.join('?'),
    values,
  }),
}));

vi.mock('@fleet/main-worker', () => ({
  applyDispatchBoardEvent: mockApplyDispatchBoardEvent,
  DISPATCH_BOARD_PROJECTION_NAME: 'dispatch_board',
}));

vi.mock('../src/database/schema/index.js', () => ({
  syncChangeFeed: {
    serverSeq: 'syncChangeFeed.serverSeq',
    aggregateType: 'syncChangeFeed.aggregateType',
    aggregateId: 'syncChangeFeed.aggregateId',
    delta: 'syncChangeFeed.delta',
    createdAt: 'syncChangeFeed.createdAt',
    companyId: 'syncChangeFeed.companyId',
  },
  dispatchBoardProjection: {
    roadRunId: 'dispatchBoardProjection.roadRunId',
    companyId: 'dispatchBoardProjection.companyId',
    deletedAt: 'dispatchBoardProjection.deletedAt',
  },
  projectionStatus: {
    projectionName: 'projectionStatus.projectionName',
    scope: 'projectionStatus.scope',
  },
}));

import { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';

interface InsertCall { table: unknown; values?: Record<string, unknown> | undefined; onConflictDoNothing?: boolean; onConflictDoUpdate?: { target?: unknown; set?: Record<string, unknown> } | undefined }
interface ExecuteCall { sqlArg: unknown }
interface SelectCall { shape?: Record<string, unknown> | undefined; from?: unknown; where?: unknown; limit?: number; orderBy?: unknown }
interface UpdateCall { table: unknown; set?: Record<string, unknown> | undefined; where?: unknown }
interface DeleteCall { table: unknown; where?: unknown }

interface FakeTx {
  insertCalls: InsertCall[];
  executeCalls: ExecuteCall[];
  selectCalls: SelectCall[];
  updateCalls: UpdateCall[];
  deleteCalls: DeleteCall[];
}

interface MakeDbOptions {
  executeReturns?: { rows: { watermark: string | bigint }[] };
  // returns by select call order: status select (n/a, uses execute), events select, then per-event currentRows selects
  eventsReturn?: unknown[];
  currentRowsReturns?: unknown[][];
}

function makeFakeDb(opts: MakeDbOptions = {}): { db: object; tx: FakeTx } {
  const tx: FakeTx = {
    insertCalls: [],
    executeCalls: [],
    selectCalls: [],
    updateCalls: [],
    deleteCalls: [],
  };
  let selectIdx = 0;
  const eventsReturn = opts.eventsReturn ?? [];
  const currentRowsReturns = opts.currentRowsReturns ?? [];

  const txObj = {
    insert: (table: unknown) => {
      const call: InsertCall = { table };
      tx.insertCalls.push(call);
      return {
        values: (v: Record<string, unknown>) => {
          call.values = v;
          return {
            onConflictDoNothing: () => {
              call.onConflictDoNothing = true;
              return Promise.resolve();
            },
            onConflictDoUpdate: (cfg: { target?: unknown; set?: Record<string, unknown> }) => {
              call.onConflictDoUpdate = cfg;
              return Promise.resolve();
            },
          };
        },
      };
    },
    execute: (sqlArg: unknown) => {
      tx.executeCalls.push({ sqlArg });
      return Promise.resolve(opts.executeReturns ?? { rows: [] });
    },
    select: (shape?: Record<string, unknown>) => {
      const call: SelectCall = { shape };
      tx.selectCalls.push(call);
      const myIdx = selectIdx++;
      return {
        from: (table: unknown) => {
          call.from = table;
          return {
            where: (predicate: unknown) => {
              call.where = predicate;
              return {
                orderBy: (ob: unknown) => {
                  call.orderBy = ob;
                  return {
                    limit: (n: number) => {
                      call.limit = n;
                      // myIdx 0 = events select; subsequent = currentRows (currentRowsReturns[myIdx-1])
                      if (myIdx === 0) return Promise.resolve(eventsReturn);
                      return Promise.resolve(currentRowsReturns[myIdx - 1] ?? []);
                    },
                  };
                },
                limit: (n: number) => {
                  call.limit = n;
                  if (myIdx === 0) return Promise.resolve(eventsReturn);
                  return Promise.resolve(currentRowsReturns[myIdx - 1] ?? []);
                },
              };
            },
          };
        },
      };
    },
    update: (table: unknown) => {
      const call: UpdateCall = { table };
      tx.updateCalls.push(call);
      return {
        set: (v: Record<string, unknown>) => {
          call.set = v;
          return {
            where: (predicate: unknown) => {
              call.where = predicate;
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete: (table: unknown) => {
      const call: DeleteCall = { table };
      tx.deleteCalls.push(call);
      return {
        where: (predicate: unknown) => {
          call.where = predicate;
          return Promise.resolve();
        },
      };
    },
  };

  const db = {
    transaction: async (fn: (tx: object) => Promise<unknown>) => fn(txObj as object),
  };
  return { db: db as object, tx };
}

beforeEach(() => {
  mockApplyDispatchBoardEvent.mockReset();
});

describe('@fleet/api - ProjectionRunnerService.drainOnce (unit)', () => {
  it('returns zeros + watermark=0 when no status row and no events', async () => {
    const { db, tx } = makeFakeDb({ executeReturns: { rows: [] }, eventsReturn: [] });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res).toEqual({
      scope: 'co-1',
      polled: 0,
      applied: 0,
      noops: 0,
      softDeletes: 0,
      newWatermark: '0',
    });
    // Should have inserted seed status row
    expect(tx.insertCalls[0]?.onConflictDoNothing).toBe(true);
    expect(tx.insertCalls[0]?.values).toMatchObject({
      projectionName: 'dispatch_board',
      scope: 'co-1',
      watermark: 0n,
      lagMs: 0,
    });
  });

  it('reads watermark as bigint when execute returns bigint (kills typeof branch)', async () => {
    const { db, tx } = makeFakeDb({
      executeReturns: { rows: [{ watermark: 42n }] },
      eventsReturn: [],
    });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.newWatermark).toBe('42');
    // events select where clause uses gt(serverSeq, 42n)
    const eventsSelect = tx.selectCalls[0];
    if (!eventsSelect) throw new Error('expected events select');
    expect(eventsSelect.where).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'syncChangeFeed.companyId', value: 'co-1' },
        { _kind: 'gt', col: 'syncChangeFeed.serverSeq', value: 42n },
      ],
    });
  });

  it('reads watermark via BigInt() when execute returns string', async () => {
    const { db } = makeFakeDb({
      executeReturns: { rows: [{ watermark: '7' }] },
      eventsReturn: [],
    });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.newWatermark).toBe('7');
  });

  it('limits events query to POLL_BATCH_SIZE=200 (kills limit literal)', async () => {
    const { db, tx } = makeFakeDb({ eventsReturn: [] });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    expect(tx.selectCalls[0]?.limit).toBe(200);
  });

  it('applies upsert decisions and counts applied++', async () => {
    const events = [
      { serverSeq: 10n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date(Date.now() - 1000) },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({
      kind: 'upsert',
      row: {
        roadRunId: 'rr-1',
        state: 'planned',
        assignedOperatorId: null,
        assignedAssetId: null,
        plannedStartAt: null,
        stopCount: 2,
        transportOrderRefs: ['to-1'],
        serverSeq: 10n,
      },
    });
    const { db, tx } = makeFakeDb({ eventsReturn: events, currentRowsReturns: [[]] });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.applied).toBe(1);
    expect(res.noops).toBe(0);
    expect(res.softDeletes).toBe(0);
    expect(res.polled).toBe(1);
    expect(res.newWatermark).toBe('10');
    // upsert was via insert().values().onConflictDoUpdate()
    const upsertCall = tx.insertCalls.find((c) => c.onConflictDoUpdate !== undefined);
    if (!upsertCall) throw new Error('expected upsert insert');
    expect(upsertCall.values).toMatchObject({
      roadRunId: 'rr-1',
      companyId: 'co-1',
      businessUnitId: 'co-1',
      depotId: 'co-1',
      legalEntityId: 'co-1',
      state: 'planned',
      stopCount: 2,
    });
    // upsert re-activates a hidden row by clearing deleted_at
    expect(upsertCall.onConflictDoUpdate?.set).toMatchObject({ deletedAt: null });
  });

  it('applies soft_delete decisions as an UPDATE setting deleted_at and counts softDeletes++', async () => {
    const events = [
      { serverSeq: 5n, aggregateType: 'road_run', aggregateId: 'rr-9', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'soft_delete', roadRunId: 'rr-9', serverSeq: 5n });
    const { db, tx } = makeFakeDb({ eventsReturn: events, currentRowsReturns: [[]] });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.softDeletes).toBe(1);
    expect(res.applied).toBe(0);
    expect(res.noops).toBe(0);
    // NO physical delete is ever issued (app role holds no DELETE privilege).
    expect(tx.deleteCalls).toHaveLength(0);
    // The soft-delete is an UPDATE setting deleted_at. updateCalls[0] is the soft-delete;
    // updateCalls[1] is the projection_status watermark update at the end.
    const softDeleteUpdate = tx.updateCalls[0];
    if (!softDeleteUpdate) throw new Error('expected soft-delete update');
    expect(softDeleteUpdate.set).toMatchObject({ serverSeq: 5n });
    expect(softDeleteUpdate.set?.['deletedAt'] instanceof Date).toBe(true);
    expect(softDeleteUpdate.where).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'dispatchBoardProjection.roadRunId', value: 'rr-9' },
        { _kind: 'eq', col: 'dispatchBoardProjection.companyId', value: 'co-1' },
        { _kind: 'isNull', col: 'dispatchBoardProjection.deletedAt' },
      ],
    });
  });

  it('handles noop decisions and counts noops++', async () => {
    const events = [
      { serverSeq: 3n, aggregateType: 'road_run', aggregateId: 'rr-2', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db, tx } = makeFakeDb({ eventsReturn: events, currentRowsReturns: [[]] });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.noops).toBe(1);
    expect(res.applied).toBe(0);
    expect(res.softDeletes).toBe(0);
    // No delete, no upsert
    expect(tx.deleteCalls).toHaveLength(0);
    const upsertCall = tx.insertCalls.find((c) => c.onConflictDoUpdate !== undefined);
    expect(upsertCall).toBeUndefined();
  });

  it('catches policy throw, counts as noop, advances watermark, continues loop', async () => {
    const events = [
      { serverSeq: 1n, aggregateType: 'road_run', aggregateId: 'rr-a', delta: {}, createdAt: new Date() },
      { serverSeq: 2n, aggregateType: 'road_run', aggregateId: 'rr-b', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockImplementationOnce(() => {
      throw new Error('policy boom');
    });
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[], []],
    });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.noops).toBe(2);
    expect(res.polled).toBe(2);
    expect(res.newWatermark).toBe('2');
  });
  it('catches non-Error policy throw via String(err) fallback (line 126 branch)', async () => {
    const events = [
      { serverSeq: 1n, aggregateType: 'road_run', aggregateId: 'rr-a', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentional non-Error to cover String(err) branch
      throw 'string boom';
    });
    const { db } = makeFakeDb({ eventsReturn: events, currentRowsReturns: [[]] });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.noops).toBe(1);
    expect(res.newWatermark).toBe('1');
  });

  it('processes ALL events in the batch (kills for-loop BlockStatement)', async () => {
    const events = [
      { serverSeq: 1n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date() },
      { serverSeq: 2n, aggregateType: 'road_run', aggregateId: 'rr-2', delta: {}, createdAt: new Date() },
      { serverSeq: 3n, aggregateType: 'road_run', aggregateId: 'rr-3', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValue({ kind: 'noop' });
    const { db } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[], [], []],
    });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(mockApplyDispatchBoardEvent).toHaveBeenCalledTimes(3);
    expect(res.noops).toBe(3);
    expect(res.newWatermark).toBe('3');
  });

  it('advances watermark to the highest event serverSeq processed', async () => {
    const events = [
      { serverSeq: 5n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date() },
      { serverSeq: 7n, aggregateType: 'road_run', aggregateId: 'rr-2', delta: {}, createdAt: new Date() },
      { serverSeq: 9n, aggregateType: 'road_run', aggregateId: 'rr-3', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValue({ kind: 'noop' });
    const { db } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[], [], []],
    });
    const svc = new ProjectionRunnerService(db as never);
    const res = await svc.drainOnce('co-1');
    expect(res.newWatermark).toBe('9');
  });

  it('builds current RoadRunProjectionRow from existing currentRow (non-null path)', async () => {
    const events = [
      { serverSeq: 4n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date() },
    ];
    const existingRow = {
      roadRunId: 'rr-1',
      state: 'planned',
      assignedOperatorId: 'op-1',
      assignedAssetId: 'asset-1',
      plannedStartAt: new Date('2026-05-01T00:00:00Z'),
      stopCount: 2,
      transportOrderRefs: ['to-1'],
      serverSeq: 3n,
    };
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[existingRow]],
    });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    // Verify the current arg passed to applyDispatchBoardEvent has plannedStartAt as ISO string
    const call = mockApplyDispatchBoardEvent.mock.calls[0];
    if (!call) throw new Error('expected policy call');
    const [, current] = call;
    expect(current).toMatchObject({
      roadRunId: 'rr-1',
      state: 'planned',
      assignedOperatorId: 'op-1',
      plannedStartAt: '2026-05-01T00:00:00.000Z',
    });
  });

  it('current-row load filters out soft-deleted rows (deleted_at IS NULL predicate)', async () => {
    const events = [
      { serverSeq: 4n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db, tx } = makeFakeDb({ eventsReturn: events, currentRowsReturns: [[]] });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    // selectCalls[0] is events; selectCalls[1] is the current-row load.
    const currentLoad = tx.selectCalls[1];
    if (!currentLoad) throw new Error('expected current-row select');
    expect(currentLoad.where).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'dispatchBoardProjection.roadRunId', value: 'rr-1' },
        { _kind: 'eq', col: 'dispatchBoardProjection.companyId', value: 'co-1' },
        { _kind: 'isNull', col: 'dispatchBoardProjection.deletedAt' },
      ],
    });
  });

  it('passes null current when no currentRow exists', async () => {
    const events = [
      { serverSeq: 1n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: new Date() },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[]],
    });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    const call = mockApplyDispatchBoardEvent.mock.calls[0];
    if (!call) throw new Error('expected policy call');
    const [, current] = call;
    expect(current).toBeNull();
  });

  it('updates projection_status with new watermark + lagMs > 0 when events present', async () => {
    const oldCreatedAt = new Date(Date.now() - 5000);
    const events = [
      { serverSeq: 8n, aggregateType: 'road_run', aggregateId: 'rr-1', delta: {}, createdAt: oldCreatedAt },
    ];
    mockApplyDispatchBoardEvent.mockReturnValueOnce({ kind: 'noop' });
    const { db, tx } = makeFakeDb({
      eventsReturn: events,
      currentRowsReturns: [[]],
    });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    // The only update is the projection_status watermark update (noop event = no soft-delete).
    expect(tx.updateCalls).toHaveLength(1);
    const upd = tx.updateCalls[0];
    if (!upd) throw new Error('expected update');
    expect(upd.set).toMatchObject({ watermark: 8n });
    expect(typeof upd.set?.['lagMs']).toBe('number');
    expect((upd.set?.['lagMs'] as number) >= 4000).toBe(true);
  });

  it('sets lagMs=0 when no events', async () => {
    const { db, tx } = makeFakeDb({ eventsReturn: [] });
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce('co-1');
    const upd = tx.updateCalls[0];
    if (!upd) throw new Error('expected update');
    expect(upd.set?.['lagMs']).toBe(0);
  });
});
