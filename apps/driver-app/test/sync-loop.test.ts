// apps/driver-app/test/sync-loop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSyncOnce, type SyncTransport, type SyncStateStore } from '../src/sync/sync-loop.js';
import type { QueuedActionWithPayload } from '../src/sync/sync-policy.js';
import { createActionId, createAggregateId, createSyncCursor, type SyncResponse, type SyncCursor } from '@fleet/sync-protocol';

const cursor0 = createSyncCursor('0');
const aggId = createAggregateId('11111111-1111-4111-8111-111111111111');

function action(id: string, sequence: number): QueuedActionWithPayload {
  return {
    actionId: createActionId(id),
    aggregateType: 'road_run',
    aggregateId: aggId,
    status: 'pending',
    sequence,
    blockedByActionId: null,
    payload: { foo: sequence },
  };
}

interface StoreFixture {
  store: SyncStateStore;
  applySyncCommit: ReturnType<typeof vi.fn>;
  rollbackDispatched: ReturnType<typeof vi.fn>;
  resetForCursorExpired: ReturnType<typeof vi.fn>;
  claimDispatched: ReturnType<typeof vi.fn>;
}

function makeStore(initial: {
  dispatchable?: readonly QueuedActionWithPayload[];
  cursor?: SyncCursor;
  applySyncCommitImpl?: () => Promise<void>;
  rollbackImpl?: () => Promise<void>;
  resetImpl?: () => Promise<void>;
}): StoreFixture {
  const applySyncCommit = vi.fn(initial.applySyncCommitImpl ?? (() => Promise.resolve()));
  const rollbackDispatched = vi.fn(initial.rollbackImpl ?? (() => Promise.resolve()));
  const resetForCursorExpired = vi.fn(initial.resetImpl ?? (() => Promise.resolve()));
  const claimDispatched = vi.fn(() => Promise.resolve());
  const store: SyncStateStore = {
    readDispatchable: () => Promise.resolve(initial.dispatchable ?? []),
    readCursor: () => Promise.resolve(initial.cursor ?? cursor0),
    applySyncCommit,
    rollbackDispatched,
    resetForCursorExpired,
    claimDispatched,
  };
  return { store, applySyncCommit, rollbackDispatched, resetForCursorExpired, claimDispatched };
}

const okResponse = (results: readonly string[], newCursor = '100'): SyncResponse => ({
  status: 'ok',
  newCursor: createSyncCursor(newCursor),
  eventSeq: Number(newCursor),
  results: results as readonly SyncResponse['results'][number][],
  serverTime: '2026-04-29T00:00:00.000Z',
  deltas: [],
  projectionStatus: {},
  hysteresisVersion: 0,
  configFlagVersion: 0,
});

const cursorExpiredResponse = (): SyncResponse => ({
  status: 'cursor_expired',
  newCursor: createSyncCursor('0'),
  eventSeq: 0,
  results: [],
  serverTime: '',
  deltas: [],
  projectionStatus: {},
  hysteresisVersion: 0,
  configFlagVersion: 0,
});

describe('@fleet/driver-app - runSyncOnce', () => {
  it('returns idle on empty heartbeat with no server work', async () => {
    const f = makeStore({});
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(okResponse([])) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('idle');
    expect(f.applySyncCommit).toHaveBeenCalledTimes(1);
    expect(f.applySyncCommit).toHaveBeenCalledWith(expect.objectContaining({ transitions: [], deltas: [] }));
  });

  it('applies transitions + new cursor for accepted batch', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const f = makeStore({ dispatchable: [action(id, 1)] });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(okResponse(['applied'], '500')) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') throw new Error('expected applied');
    expect(out.newCursor).toBe('500');
    expect(out.transitions).toHaveLength(1);
    expect(out.transitions[0]?.newStatus).toBe('synced');
    expect(f.applySyncCommit).toHaveBeenCalledTimes(1);
  });

  it('triggers cursor_expired_recovered (no dispatched ids leak to store)', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const f = makeStore({ dispatchable: [action(id, 1)] });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(cursorExpiredResponse()) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('cursor_expired_recovered');
    expect(f.resetForCursorExpired).toHaveBeenCalledTimes(1);
    expect(f.resetForCursorExpired).toHaveBeenCalledWith();
    expect(f.applySyncCommit).not.toHaveBeenCalled();
  });

  it('rolls back dispatched ids on transport failure (preserves Error instance)', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const f = makeStore({ dispatchable: [action(id, 1)] });
    const networkErr = new Error('network unreachable');
    const transport: SyncTransport = { post: vi.fn().mockRejectedValue(networkErr) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('transport_failure');
    if (out.kind !== 'transport_failure') throw new Error('expected transport_failure');
    expect(out.error).toBe(networkErr);
    expect(out.rolledBackCount).toBe(1);
    expect(f.rollbackDispatched).toHaveBeenCalledTimes(1);
    expect(f.applySyncCommit).not.toHaveBeenCalled();
  });

  it('does NOT roll back when transport fails on empty heartbeat', async () => {
    const f = makeStore({});
    const transport: SyncTransport = { post: vi.fn().mockRejectedValue(new Error('server down')) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('transport_failure');
    if (out.kind !== 'transport_failure') throw new Error('expected transport_failure');
    expect(out.rolledBackCount).toBe(0);
    expect(f.rollbackDispatched).not.toHaveBeenCalled();
  });

  it('rolls back on protocol_violation (results length mismatch)', async () => {
    const id1 = 'aaaaaaaa-1111-4111-8111-111111111111';
    const id2 = 'bbbbbbbb-1111-4111-8111-111111111111';
    const f = makeStore({ dispatchable: [action(id1, 1), action(id2, 2)] });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(okResponse(['applied'])) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('protocol_violation');
    if (out.kind !== 'protocol_violation') throw new Error('expected protocol_violation');
    expect(out.expected).toBe(2);
    expect(out.actual).toBe(1);
    expect(f.rollbackDispatched).toHaveBeenCalledTimes(1);
    expect(f.applySyncCommit).not.toHaveBeenCalled();
  });

  it('returns storage_failure when applyAck throws', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const dbErr = new Error('database is locked');
    const f = makeStore({
      dispatchable: [action(id, 1)],
      applySyncCommitImpl: () => Promise.reject(dbErr),
    });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(okResponse(['applied'])) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('storage_failure');
    if (out.kind !== 'storage_failure') throw new Error('expected storage_failure');
    expect(out.stage).toBe('apply_ack');
    expect(out.error).toBe(dbErr);
  });

  it('returns storage_failure when rollback itself throws on transport failure', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const dbErr = new Error('rollback failed');
    const f = makeStore({
      dispatchable: [action(id, 1)],
      rollbackImpl: () => Promise.reject(dbErr),
    });
    const transport: SyncTransport = { post: vi.fn().mockRejectedValue(new Error('net')) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('storage_failure');
    if (out.kind !== 'storage_failure') throw new Error('expected storage_failure');
    expect(out.stage).toBe('rollback');
    expect(out.error).toBe(dbErr);
  });

  it('returns storage_failure when resetForCursorExpired throws', async () => {
    const dbErr = new Error('cannot reset');
    const f = makeStore({
      applySyncCommitImpl: () => Promise.resolve(),
      resetImpl: () => Promise.reject(dbErr),
    });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(cursorExpiredResponse()) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('storage_failure');
    if (out.kind !== 'storage_failure') throw new Error('expected storage_failure');
    expect(out.stage).toBe('reset');
    expect(out.error).toBe(dbErr);
  });


  it('returns applied (not idle) when server pushes deltas during empty heartbeat', async () => {
    const f = makeStore({});
    const responseWithDeltas: SyncResponse = {
      ...okResponse([], '200'),
      deltas: [{ aggregate: 'road_run', id: 'x', state: 'started' }],
    };
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(responseWithDeltas) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('applied');
    expect(f.applySyncCommit).toHaveBeenCalledTimes(1);
    const commitArg = f.applySyncCommit.mock.calls[0]?.[0];
    expect(commitArg?.deltas).toHaveLength(1);
    expect(commitArg?.newCursor).toBe('200');
  });

  it('returns storage_failure when rollback throws on protocol_violation', async () => {
    const id1 = 'aaaaaaaa-1111-4111-8111-111111111111';
    const id2 = 'bbbbbbbb-1111-4111-8111-111111111111';
    const dbErr = new Error('rollback failed during protocol violation');
    const f = makeStore({
      dispatchable: [action(id1, 1), action(id2, 2)],
      rollbackImpl: () => Promise.reject(dbErr),
    });
    const transport: SyncTransport = { post: vi.fn().mockResolvedValue(okResponse(['applied'])) };
    const out = await runSyncOnce(transport, f.store);
    expect(out.kind).toBe('storage_failure');
    if (out.kind !== 'storage_failure') throw new Error('expected storage_failure');
    expect(out.stage).toBe('rollback');
    expect(out.error).toBe(dbErr);
  });
  it('passes correct cursor + actions to transport', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111';
    const cursor = createSyncCursor('42');
    const f = makeStore({ dispatchable: [action(id, 1)], cursor });
    const post = vi.fn().mockResolvedValue(okResponse(['applied']));
    const transport: SyncTransport = { post };
    await runSyncOnce(transport, f.store);
    expect(post).toHaveBeenCalledTimes(1);
    const req = post.mock.calls[0]?.[0];
    expect(req?.cursor).toBe('42');
    expect(req?.actions).toHaveLength(1);
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - runSyncOnce property invariants', () => {
  it('never calls applyAck when transport throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (n) => {
          const acts = Array.from({ length: n }, (_, i) => {
            const hex = (i + 1).toString(16).padStart(8, '0');
            return action(`${hex}-1111-4111-8111-111111111111`, i + 1);
          });
          const f = makeStore({ dispatchable: acts });
          const transport: SyncTransport = { post: vi.fn().mockRejectedValue(new Error('boom')) };
          const out = await runSyncOnce(transport, f.store);
          expect(out.kind === 'transport_failure' || out.kind === 'storage_failure').toBe(true);
          expect(f.applySyncCommit).not.toHaveBeenCalled();
          return true;
        },
      ),
    );
  });

  it('rolls back exactly the dispatched action count when transport throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (n) => {
          const acts = Array.from({ length: n }, (_, i) => {
            const hex = (i + 1).toString(16).padStart(8, '0');
            return action(`${hex}-1111-4111-8111-111111111111`, i + 1);
          });
          const f = makeStore({ dispatchable: acts });
          const transport: SyncTransport = { post: vi.fn().mockRejectedValue(new Error('net')) };
          const out = await runSyncOnce(transport, f.store);
          if (out.kind === 'transport_failure') {
            expect(out.rolledBackCount).toBe(n);
            expect(f.rollbackDispatched).toHaveBeenCalledTimes(1);
          }
          return true;
        },
      ),
    );
  });

  it('cursor_expired path always invokes resetForCursorExpired and never applyAck', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (n) => {
          const acts = Array.from({ length: n }, (_, i) => {
            const hex = (i + 1).toString(16).padStart(8, '0');
            return action(`${hex}-1111-4111-8111-111111111111`, i + 1);
          });
          const f = makeStore({ dispatchable: acts });
          const transport: SyncTransport = { post: vi.fn().mockResolvedValue(cursorExpiredResponse()) };
          const out = await runSyncOnce(transport, f.store);
          expect(out.kind).toBe('cursor_expired_recovered');
          expect(f.resetForCursorExpired).toHaveBeenCalledTimes(1);
          expect(f.applySyncCommit).not.toHaveBeenCalled();
          return true;
        },
      ),
    );
  });
});
