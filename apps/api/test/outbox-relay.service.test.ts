// apps/api/test/outbox-relay.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';

interface FakeRow {
  outboxId: string;
  queueName: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  payload: { eventType: string; aggregateType: string };
}

const mockAdd = vi.fn();
const mockClose = vi.fn();
const QueueMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class {
    add = mockAdd;
    close = mockClose;
    constructor(...args: unknown[]) { QueueMock(...args); }
  },
}));

interface FakeDbResult { db: object; updates: { outboxId: string; status?: string; attempts?: number; nextAttemptAt?: Date | null }[] }
function makeFakeDb(rows: FakeRow[]): FakeDbResult {
  const updates: { outboxId: string; status?: string; attempts?: number; nextAttemptAt?: Date | null }[] = [];
  // Map FakeRow (camelCase) -> ClaimedRow (snake_case) shape returned by raw SQL.
  const claimedRows = rows.map((r) => ({
    outbox_id: r.outboxId,
    queue_name: r.queueName,
    status: r.status,
    attempts: r.attempts,
    next_attempt_at: r.nextAttemptAt,
    payload: r.payload,
  }));
  // The claim now runs inside db.transaction(async (tx) => ...). The SELECT ...
  // FOR UPDATE SKIP LOCKED returns the pending rows; the in-tx claim-UPDATE that
  // optimistically flips them to 'sent' is a raw tx.execute(UPDATE ...) which we
  // record as a single batch 'sent' update for each claimed row so the existing
  // "marks sent" assertions still see the status transition. tx exposes the same
  // execute/update surface as db, so per-row dead-letter/retry .update() calls
  // (which run post-claim on db, outside the tx) continue to populate `updates`.
  let claimExecuteSeen = false;
  const execute = (): Promise<{ rows: typeof claimedRows }> => {
    // First execute() in the tx is the SELECT ... FOR UPDATE SKIP LOCKED that
    // returns the claimed rows; the second is the in-tx claim-UPDATE that flips
    // them to 'sent'. We deliberately do NOT record the claim-UPDATE into
    // `updates` here: this unit test tracks the per-row terminal transitions
    // (sent on the happy path, dead_letter / failed on the error paths) made via
    // db.update().set().where(), and asserts on updates[0]. The optimistic
    // claim-time 'sent' is an internal of the new transactional claim and is
    // covered by the integration test against a real database; leaving it out of
    // `updates` keeps these unit assertions focused on terminal state and order.
    if (!claimExecuteSeen) {
      claimExecuteSeen = true;
      return Promise.resolve({ rows: claimedRows });
    }
    return Promise.resolve({ rows: [] as typeof claimedRows });
  };
  interface UpdateChain {
    set: (vals: { status?: string; attempts?: number; nextAttemptAt?: Date | null }) => {
      where: (predicate: { _which: 'outboxId'; value: string }) => Promise<void>;
    };
  }
  const update = (): UpdateChain => ({
    set: (vals: { status?: string; attempts?: number; nextAttemptAt?: Date | null }) => ({
      where: (predicate: { _which: 'outboxId'; value: string }): Promise<void> => {
        updates.push({ outboxId: predicate.value, ...vals });
        return Promise.resolve();
      },
    }),
  });
  const dbObj = {
    execute,
    update,
    // Mock db.transaction: invoke the callback with tx = the same fake surface,
    // so tx.execute (SELECT then claim-UPDATE) and any tx.update behave like db.
    transaction: <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(dbObj),
  };
  return {
    db: dbObj as unknown as object,
    updates,
  };
}

// Patch eq/and/or/lte/isNull to return marker objects so update().where() can identify outboxId.
vi.mock('drizzle-orm', () => {
  // sql is a tagged-template function in drizzle; the relay also calls sql.join()
  // to build the claim-UPDATE's IN (...) list. Provide both so the mocked module
  // matches the real surface the service touches.
  const sql = Object.assign(
    (..._args: unknown[]) => ({ _sql: true }),
    { join: (..._args: unknown[]) => ({ _sql: true, _join: true }) },
  );
  return {
    eq: (col: unknown, value: unknown) => ({ _which: 'outboxId', value, _col: col }),
    sql,
  };
});

vi.mock('../src/database/schema/index.js', () => ({
  outbox: {
    outboxId: 'outboxId',
    status: 'status',
    nextAttemptAt: 'nextAttemptAt',
  },
}));

beforeEach(() => {
  mockAdd.mockReset();
  mockClose.mockReset();
  QueueMock.mockReset();
  mockAdd.mockResolvedValue(undefined);
});

describe('OutboxRelayService - drainOnce', () => {
  it('routes manifest_intake.requested rows to intake queue and marks sent', async () => {
    const rows: FakeRow[] = [{
      outboxId: 'r1',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'manifest_intake.requested', aggregateType: 'manifest_intake' },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.enqueued).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(QueueMock).toHaveBeenCalledWith('intake', expect.any(Object));
    // The happy-path 'sent' transition now happens atomically inside the
    // transactional claim (raw UPDATE under the held lock), not via a per-row
    // db.update() after enqueue. So a successful enqueue leaves `updates` empty:
    // the row was neither dead-lettered nor retried. result.enqueued === 1 above
    // is the assertion that it was marked sent; the real DB write is covered by
    // the integration test.
    expect(updates).toHaveLength(0);
  });

  it('routes manifest.committed to erp queue', async () => {
    const rows: FakeRow[] = [{
      outboxId: 'r2',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'manifest.committed', aggregateType: 'manifest' },
    }];
    const { db } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.enqueued).toBe(1);
    expect(QueueMock).toHaveBeenCalledWith('erp', expect.any(Object));
  });

  it('routes road_run.assigned to projections queue', async () => {
    const rows: FakeRow[] = [{
      outboxId: 'r3',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'road_run.assigned', aggregateType: 'road_run' },
    }];
    const { db } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.enqueued).toBe(1);
    expect(QueueMock).toHaveBeenCalledWith('projections', expect.any(Object));
  });

  it('dead-letters rows with unknown aggregate', async () => {
    const rows: FakeRow[] = [{
      outboxId: 'r4',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'rocket.launched', aggregateType: 'rocket' },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.deadLettered).toBe(1);
    expect(result.enqueued).toBe(0);
    const u = updates[0]; if (!u) throw new Error('expected update'); expect(u).toMatchObject({ status: 'dead_letter' });
  });

  it('schedules retry with exponential backoff on enqueue failure (attempts < max)', async () => {
    mockAdd.mockRejectedValueOnce(new Error('redis down'));
    const rows: FakeRow[] = [{
      outboxId: 'r5',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'road_run.x', aggregateType: 'road_run' },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.retryScheduled).toBe(1);
    expect(result.enqueued).toBe(0);
    const u0 = updates[0];
    if (!u0) throw new Error('expected update');
    expect(u0).toMatchObject({ attempts: 1 });
    expect(u0.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('dead-letters when attempts reach max threshold', async () => {
    mockAdd.mockRejectedValueOnce(new Error('redis down'));
    const rows: FakeRow[] = [{
      outboxId: 'r6',
      queueName: 'projections',
      status: 'pending',
      attempts: 4,
      nextAttemptAt: null,
      payload: { eventType: 'road_run.x', aggregateType: 'road_run' },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.deadLettered).toBe(1);
    const u = updates[0]; if (!u) throw new Error('expected update'); expect(u).toMatchObject({ status: 'dead_letter', attempts: 5 });
  });

  it('reuses queue handles across rows for the same target', async () => {
    const rows: FakeRow[] = [
      { outboxId: 'r7', queueName: 'projections', status: 'pending', attempts: 0, nextAttemptAt: null, payload: { eventType: 'road_run.a', aggregateType: 'road_run' } },
      { outboxId: 'r8', queueName: 'projections', status: 'pending', attempts: 0, nextAttemptAt: null, payload: { eventType: 'road_run.b', aggregateType: 'road_run' } },
    ];
    const { db } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    await svc.drainOnce();
    expect(QueueMock).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledTimes(2);
  });


  it('dead-letters rows with malformed payload (zod invalid_payload)', async () => {
    const rows: FakeRow[] = [{
      outboxId: 'r9',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { not_a_known_shape: true } as unknown as { eventType: string; aggregateType: string },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.deadLettered).toBe(1);
    expect(result.enqueued).toBe(0);
    const u = updates[0]; if (!u) throw new Error('expected update');
    expect(u).toMatchObject({ status: 'dead_letter' });
  });

  it('closes all queue handles on module destroy', async () => {
    const rows: FakeRow[] = [
      { outboxId: 'rA', queueName: 'projections', status: 'pending', attempts: 0, nextAttemptAt: null, payload: { eventType: 'road_run.x', aggregateType: 'road_run' } },
      { outboxId: 'rB', queueName: 'erp', status: 'pending', attempts: 0, nextAttemptAt: null, payload: { eventType: 'manifest.committed', aggregateType: 'manifest' } },
    ];
    const { db } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    await svc.drainOnce();
    expect(QueueMock).toHaveBeenCalledTimes(2);
    await svc.onModuleDestroy();
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
  it('returns zeros when no rows pending', async () => {
    const { db } = makeFakeDb([]);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result).toEqual({ polled: 0, enqueued: 0, deadLettered: 0, retryScheduled: 0 });
  });
  it('logs non-Error thrown values via String(err) (line 153 branch)', async () => {
    mockAdd.mockRejectedValueOnce('redis exploded as a string');
    const rows: FakeRow[] = [{
      outboxId: 'rNonErr',
      queueName: 'projections',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      payload: { eventType: 'road_run.x', aggregateType: 'road_run' },
    }];
    const { db, updates } = makeFakeDb(rows);
    const svc = new OutboxRelayService(db as never, { url: 'redis://x' } as never);
    const result = await svc.drainOnce();
    expect(result.retryScheduled).toBe(1);
    const u0 = updates[0]; if (u0 === undefined) throw new Error('expected update');
    expect(u0).toMatchObject({ attempts: 1 });
  });

});
