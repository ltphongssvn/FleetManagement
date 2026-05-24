// apps/api/test/sync.service.unit.test.ts
// Unit tests for SyncService — kill Stryker mutants by mocking drizzle chain,
// allocateServerSeq, appendTriWrite, mapDbErrorToSyncResult, and parseCursor.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAllocateServerSeq,
  mockAppendTriWrite,
  mockMapDbErrorToSyncResult,
  mockParseCursor,
} = vi.hoisted(() => ({
  mockAllocateServerSeq: vi.fn(),
  mockAppendTriWrite: vi.fn(),
  mockMapDbErrorToSyncResult: vi.fn(),
  mockParseCursor: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  and: (...preds: unknown[]) => ({ _kind: 'and', preds }),
  gt: (col: unknown, value: unknown) => ({ _kind: 'gt', col, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _kind: 'sql',
    raw: strings.join('?'),
    values,
  }),
}));

vi.mock('../src/database/schema/index.js', () => ({
  syncChangeFeed: {
    serverSeq: 'syncChangeFeed.serverSeq',
    actionId: 'syncChangeFeed.actionId',
    aggregateType: 'syncChangeFeed.aggregateType',
    aggregateId: 'syncChangeFeed.aggregateId',
    delta: 'syncChangeFeed.delta',
    createdAt: 'syncChangeFeed.createdAt',
    companyId: 'syncChangeFeed.companyId',
  },
}));

vi.mock('../src/database/server-seq.repository.js', () => ({
  allocateServerSeq: mockAllocateServerSeq,
}));

vi.mock('../src/database/append-tri-write.js', () => ({
  appendTriWrite: mockAppendTriWrite,
}));

vi.mock('../src/sync/error-mapping.js', () => ({
  mapDbErrorToSyncResult: mockMapDbErrorToSyncResult,
}));

vi.mock('../src/sync/parse-cursor.js', () => ({
  parseCursor: mockParseCursor,
}));

import type * as SyncProtocolModule from '@fleet/sync-protocol';
vi.mock('@fleet/sync-protocol', async () => {
  const actual = await vi.importActual<typeof SyncProtocolModule>('@fleet/sync-protocol');
  return {
    ...actual,
    OUTBOX_QUEUES: { PROJECTIONS: 'projections' },
  };
});

import { SyncService } from '../src/sync/sync.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

interface SelectCall { shape?: Record<string, unknown> | undefined }
interface WhereCall { predicate: unknown }
interface FakeDb {
  selectCalls: SelectCall[];
  whereCalls: WhereCall[];
  transactionFn: ((tx: object) => Promise<unknown>) | undefined;
  db: object;
}

interface MakeDbOptions {
  selectReturns?: unknown[];
  transactionThrows?: unknown;
}

function makeFakeDb(opts: MakeDbOptions = {}): FakeDb {
  const selectCalls: SelectCall[] = [];
  const whereCalls: WhereCall[] = [];
  const fakeTx = { __isTx: true };
  const fake: FakeDb = {
    selectCalls,
    whereCalls,
    transactionFn: undefined,
    db: {} as object,
  };
  const db = {
    select: (shape?: Record<string, unknown>) => {
      selectCalls.push({ shape });
      return {
        from: (_t: unknown) => ({
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            return {
              orderBy: (_o: unknown) => ({
                limit: (_n: number) => Promise.resolve(opts.selectReturns ?? []),
              }),
            };
          },
        }),
      };
    },
    transaction: async (fn: (tx: object) => Promise<unknown>) => {
      fake.transactionFn = fn;
      if (opts.transactionThrows !== undefined) return Promise.reject(opts.transactionThrows as Error);
      return fn(fakeTx);
    },
  };
  fake.db = db as object;
  return fake;
}

const OP: OperatorContext = Object.freeze({
  operatorId: 'op-1',
  companyId: 'co-1',
  businessUnitId: 'bu-1',
  depotId: 'dp-1',
  legalEntityId: 'le-1',
  expiresAt: 9_999_999_999,
}) as OperatorContext;

const ACTION = Object.freeze({
  actionId: 'act-1',
  aggregateType: 'road_run',
  aggregateId: 'rr-1',
  timestamp: '2026-05-01T00:00:00.000Z',
  payload: { foo: 'bar' },
});

beforeEach(() => {
  mockAllocateServerSeq.mockReset();
  mockAppendTriWrite.mockReset();
  mockMapDbErrorToSyncResult.mockReset();
  mockParseCursor.mockReset();
  mockParseCursor.mockReturnValue(0n);
  mockAllocateServerSeq.mockResolvedValue(1n);
  mockAppendTriWrite.mockResolvedValue(undefined);
});

describe('@fleet/api - SyncService.processSync (unit)', () => {
  it('returns status=ok with no actions and no deltas (newCursor stays at request cursor)', async () => {
    mockParseCursor.mockReturnValue(42n);
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '42', actions: [] }, OP);
    expect(res.status).toBe('ok');
    expect(res.results).toEqual([]);
    expect(res.deltas).toEqual([]);
    expect(res.newCursor as string).toBe('42');
    expect(res.eventSeq).toBe(42);
  });

  it('iterates ALL actions and pushes a result per action (kills loop BlockStatement)', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [ACTION, ACTION, ACTION] }, OP);
    expect(res.results).toHaveLength(3);
    expect(res.results.every((r) => r === 'applied')).toBe(true);
    expect(mockAppendTriWrite).toHaveBeenCalledTimes(3);
  });

  it('uses the LAST delta row server_seq as newCursor (kills length - 1 ArithmeticOperator)', async () => {
    mockParseCursor.mockReturnValue(0n);
    const rows = [
      { serverSeq: '10', actionId: 'a', aggregateType: 't', aggregateId: 'x', delta: {}, createdAt: new Date() },
      { serverSeq: '20', actionId: 'b', aggregateType: 't', aggregateId: 'y', delta: {}, createdAt: new Date() },
      { serverSeq: '30', actionId: 'c', aggregateType: 't', aggregateId: 'z', delta: {}, createdAt: new Date() },
    ];
    const fake = makeFakeDb({ selectReturns: rows });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [] }, OP);
    expect(res.newCursor as string).toBe('30');
    expect(res.eventSeq).toBe(30);
    expect(res.deltas).toHaveLength(3);
  });

  it('filters deltas by (companyId AND server_seq > cursor) — kills and()/eq()/gt() mutants', async () => {
    mockParseCursor.mockReturnValue(7n);
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    await svc.processSync({ cursor: '7', actions: [] }, OP);
    expect(mockParseCursor).toHaveBeenCalledWith('7');
    const whereCall = fake.whereCalls[0];
    if (!whereCall) throw new Error('expected where');
    expect(whereCall.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'syncChangeFeed.companyId', value: OP.companyId },
        { _kind: 'gt', col: 'syncChangeFeed.serverSeq', value: 7n },
      ],
    });
  });

  it('throws when server_seq exceeds Number.MAX_SAFE_INTEGER (kills isSafeInteger guard mutants)', async () => {
    const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 100n).toString();
    const rows = [
      { serverSeq: huge, actionId: 'a', aggregateType: 't', aggregateId: 'x', delta: {}, createdAt: new Date() },
    ];
    const fake = makeFakeDb({ selectReturns: rows });
    const svc = new SyncService(fake.db as never);
    await expect(svc.processSync({ cursor: '0', actions: [] }, OP)).rejects.toThrow(/safe integer range/i);
  });

  it('returns full SyncResponse shape with all required fields (kills return-shape ObjectLiteral)', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [] }, OP);
    expect(res).toMatchObject({
      status: 'ok',
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    });
    expect(typeof res.serverTime).toBe('string');
    expect(() => new Date(res.serverTime).toISOString()).not.toThrow();
  });
});

describe('@fleet/api - SyncService.applyAction via processSync (unit)', () => {
  it('returns applied when appendTriWrite succeeds (kills "applied" StringLiteral)', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [ACTION] }, OP);
    expect(res.results).toEqual(['applied']);
  });

  it('calls appendTriWrite with eventType=<aggregateType>.action_received (kills StringLiteral)', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    await svc.processSync({ cursor: '0', actions: [ACTION] }, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite call');
    const [, params] = call;
    const p = params as Record<string, unknown>;
    expect(p['eventType']).toBe('road_run.action_received');
    expect(p['actionId']).toBe('act-1');
    expect(p['aggregateType']).toBe('road_run');
    expect(p['aggregateId']).toBe('rr-1');
    expect(p['queueName']).toBe('projections');
    expect(p['outboxPayload']).toEqual({
      actionId: 'act-1',
      aggregateType: 'road_run',
      aggregateId: 'rr-1',
    });
  });

  it('on tx rejection, maps to duplicate and returns it (kills duplicate-branch BlockStatement)', async () => {
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    mockMapDbErrorToSyncResult.mockReturnValue('duplicate');
    const fake = makeFakeDb({ selectReturns: [], transactionThrows: dupErr });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [ACTION] }, OP);
    expect(res.results).toEqual(['duplicate']);
    expect(mockMapDbErrorToSyncResult).toHaveBeenCalledWith(dupErr);
  });

  it('on tx rejection mapped to error, returns the error result (kills else-branch BlockStatement)', async () => {
    const otherErr = new Error('boom');
    mockMapDbErrorToSyncResult.mockReturnValue('error');
    const fake = makeFakeDb({ selectReturns: [], transactionThrows: otherErr });
    const svc = new SyncService(fake.db as never);
    const res = await svc.processSync({ cursor: '0', actions: [ACTION] }, OP);
    expect(res.results).toEqual(['error']);
  });
});

describe('@fleet/api - SyncService.deltasAfter (unit)', () => {
  it('returns rows from the select chain', async () => {
    const rows = [
      { serverSeq: '5', actionId: 'a', aggregateType: 't', aggregateId: 'x', delta: {} },
    ];
    mockParseCursor.mockReturnValue(0n);
    const fake = makeFakeDb({ selectReturns: rows });
    const svc = new SyncService(fake.db as never);
    const out = await svc.deltasAfter('0', OP);
    expect(out).toBe(rows);
  });

  it('parses the cursor and filters by (companyId AND server_seq > cursorBig)', async () => {
    mockParseCursor.mockReturnValue(99n);
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new SyncService(fake.db as never);
    await svc.deltasAfter('99', OP);
    expect(mockParseCursor).toHaveBeenCalledWith('99');
    const whereCall = fake.whereCalls[0];
    if (!whereCall) throw new Error('expected where');
    expect(whereCall.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'syncChangeFeed.companyId', value: OP.companyId },
        { _kind: 'gt', col: 'syncChangeFeed.serverSeq', value: 99n },
      ],
    });
  });
});
