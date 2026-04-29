// apps/api/test/projection-runner.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';

interface FeedRow {
  serverSeq: bigint;
  aggregateType: string;
  aggregateId: string;
  delta: unknown;
  createdAt: Date;
}

interface DispatchRow {
  roadRunId: string;
  state: string;
  assignedOperatorId: string | null;
  assignedAssetId: string | null;
  plannedStartAt: Date | null;
  stopCount: number;
  transportOrderRefs: readonly string[];
  serverSeq: bigint;
}

interface FakeState {
  watermark: bigint;
  events: FeedRow[];
  rows: Map<string, DispatchRow>;
  inserted: number;
  updated: number;
  deleted: number;
  statusUpdated: { watermark: bigint; lagMs: number } | null;
}

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ _and: x }),
  eq: (col: unknown, value: unknown) => ({ _eq: [col, value] }),
  gt: (col: unknown, value: unknown) => ({ _gt: [col, value] }),
  sql: (..._a: unknown[]) => ({ _sql: true }),
}));

vi.mock('../src/database/schema/index.js', () => ({
  syncChangeFeed: { companyId: 'companyId', serverSeq: 'serverSeq' },
  dispatchBoardProjection: { roadRunId: 'roadRunId' },
  projectionStatus: { projectionName: 'projectionName', scope: 'scope' },
}));

interface FakeDb { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>; state: FakeState }
function buildFakeDb(state: FakeState): FakeDb {
  const tx = {
    execute: () => Promise.resolve({ rows: [{ watermark: state.watermark }] }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const onConflictDoUpdate = (_cfg: unknown): Promise<void> => {
          const v = vals as unknown as DispatchRow;
          const existing = state.rows.get(v.roadRunId);
          state.rows.set(v.roadRunId, v);
          if (existing) state.updated++; else state.inserted++;
          return Promise.resolve();
        };
        const onConflictDoNothing = (): Promise<void> => Promise.resolve();
        if ((vals as { projectionName?: unknown }).projectionName !== undefined) {
          return { onConflictDoNothing, then: (cb: () => void) => Promise.resolve().then(cb) };
        }
        return { onConflictDoUpdate };
      },
    }),
    select: () => ({
      from: (_table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(state.events),
          }),
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        state.deleted++;
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (vals: { watermark?: bigint; lagMs?: number }) => ({
        where: () => {
          if (vals.watermark !== undefined && vals.lagMs !== undefined) {
            state.statusUpdated = { watermark: vals.watermark, lagMs: vals.lagMs };
          }
          return Promise.resolve();
        },
      }),
    }),
  };

  // Patch select().from(dispatchBoardProjection).where(eq(roadRunId, ev.aggregateId)).limit(1)
  (tx as { select: unknown }).select = () => ({
    from: () => ({
      where: (predicate: { _eq?: [unknown, unknown] }) => {
        const value = predicate._eq?.[1];
        const aggId: string | undefined = typeof value === 'string' ? value : undefined;
        return {
          orderBy: () => ({ limit: () => Promise.resolve(state.events) }),
          limit: (_n: number) => {
            const r = aggId !== undefined ? state.rows.get(aggId) : undefined;
            return Promise.resolve(r ? [r] : []);
          },
        };
      },
    }),
  });

  return {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    state,
  };
}

const SCOPE = '11111111-1111-4111-8111-111111111111';
const RUN_A = 'aaaaaaaa-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectionRunnerService - drainOnce', () => {
  it('inserts a new dispatch board row for an initial-create event and advances watermark', async () => {
    const state: FakeState = {
      watermark: 0n,
      rows: new Map(),
      inserted: 0,
      updated: 0,
      deleted: 0,
      statusUpdated: null,
      events: [{
        serverSeq: 5n,
        aggregateType: 'road_run',
        aggregateId: RUN_A,
        delta: {
          state: 'planned',
          assignedOperatorId: null,
          assignedAssetId: null,
          plannedStartAt: '2026-04-29T12:00:00.000Z',
          stopCount: 2,
          transportOrderRefs: ['TO-1'],
        },
        createdAt: new Date(Date.now() - 1000),
      }],
    };
    const db = buildFakeDb(state);
    const svc = new ProjectionRunnerService(db as never);
    const result = await svc.drainOnce(SCOPE);
    expect(result.applied).toBe(1);
    expect(result.noops).toBe(0);
    expect(result.deletes).toBe(0);
    expect(result.newWatermark).toBe('5');
    expect(state.inserted).toBe(1);
    expect(state.statusUpdated?.watermark).toBe(5n);
  });

  it('treats stale events (seq <= watermark) as noop without writing rows', async () => {
    const state: FakeState = {
      watermark: 100n,
      events: [{
        serverSeq: 50n,
        aggregateType: 'road_run',
        aggregateId: RUN_A,
        delta: { state: 'started' },
        createdAt: new Date(),
      }],
      rows: new Map([[RUN_A, {
        roadRunId: RUN_A,
        state: 'planned',
        assignedOperatorId: null,
        assignedAssetId: null,
        plannedStartAt: null,
        stopCount: 1,
        transportOrderRefs: [],
        serverSeq: 200n,
      }]]),
      inserted: 0,
      updated: 0,
      deleted: 0,
      statusUpdated: null,
    };
    const db = buildFakeDb(state);
    const svc = new ProjectionRunnerService(db as never);
    const result = await svc.drainOnce(SCOPE);
    expect(result.noops).toBe(1);
    expect(result.applied).toBe(0);
    expect(state.inserted).toBe(0);
    expect(state.updated).toBe(0);
  });

  it('deletes the projection row for tombstone events', async () => {
    const state: FakeState = {
      watermark: 0n,
      events: [{
        serverSeq: 10n,
        aggregateType: 'road_run',
        aggregateId: RUN_A,
        delta: { tombstone: true },
        createdAt: new Date(),
      }],
      rows: new Map([[RUN_A, {
        roadRunId: RUN_A,
        state: 'planned',
        assignedOperatorId: null,
        assignedAssetId: null,
        plannedStartAt: null,
        stopCount: 1,
        transportOrderRefs: [],
        serverSeq: 5n,
      }]]),
      inserted: 0,
      updated: 0,
      deleted: 0,
      statusUpdated: null,
    };
    const db = buildFakeDb(state);
    const svc = new ProjectionRunnerService(db as never);
    const result = await svc.drainOnce(SCOPE);
    expect(result.deletes).toBe(1);
    expect(state.deleted).toBe(1);
    expect(result.newWatermark).toBe('10');
  });

  it('returns zeros and no-op result for empty event stream', async () => {
    const state: FakeState = {
      watermark: 5n,
      events: [],
      rows: new Map(),
      inserted: 0,
      updated: 0,
      deleted: 0,
      statusUpdated: null,
    };
    const db = buildFakeDb(state);
    const svc = new ProjectionRunnerService(db as never);
    const result = await svc.drainOnce(SCOPE);
    expect(result).toMatchObject({ polled: 0, applied: 0, noops: 0, deletes: 0, newWatermark: '5' });
  });

  it('lagMs is computed from the OLDEST event in the batch (no masked backlog)', async () => {
    const oldest = new Date(Date.now() - 60_000); // 60s ago
    const newest = new Date(Date.now() - 1_000);  // 1s ago
    const state: FakeState = {
      watermark: 0n,
      events: [
        { serverSeq: 1n, aggregateType: 'road_run', aggregateId: RUN_A, delta: { state: 'planned', assignedOperatorId: null, assignedAssetId: null, plannedStartAt: null, stopCount: 0, transportOrderRefs: [] }, createdAt: oldest },
        { serverSeq: 2n, aggregateType: 'road_run', aggregateId: RUN_A, delta: { state: 'dispatched' }, createdAt: newest },
      ],
      rows: new Map(),
      inserted: 0,
      updated: 0,
      deleted: 0,
      statusUpdated: null,
    };
    const db = buildFakeDb(state);
    const svc = new ProjectionRunnerService(db as never);
    await svc.drainOnce(SCOPE);
    expect(state.statusUpdated?.lagMs).toBeGreaterThanOrEqual(50_000);
  });
});
