// apps/driver-app/test/sync-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  planSyncRequest,
  reconcileSyncAck,
  SYNC_POLICY_VERSION,
  DEFAULT_SYNC_BATCH_SIZE,
  type QueuedActionWithPayload,
} from '../src/sync/sync-policy.js';
import { createActionId, createAggregateId, createSyncCursor, type SyncResponse } from '@fleet/sync-protocol';

const cursor = createSyncCursor('0');
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

describe('@fleet/driver-app - sync-policy', () => {
  it('exports stable identifiers', () => {
    expect(SYNC_POLICY_VERSION).toBe('sync-loop-v1');
    expect(DEFAULT_SYNC_BATCH_SIZE).toBe(50);
  });

  it('plans heartbeat (empty actions) when no dispatchable', () => {
    const plan = planSyncRequest([], cursor);
    expect(plan.request.actions).toEqual([]);
    expect(plan.dispatchedActionIds).toEqual([]);
  });

  it('plans request with up to batchSize actions', () => {
    const acts = Array.from({ length: 100 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(8, '0');
      return action(`${hex}-1111-4111-8111-111111111111`, i + 1);
    });
    const plan = planSyncRequest(acts, cursor, 30);
    expect(plan.request.actions).toHaveLength(30);
    expect(plan.dispatchedActionIds).toHaveLength(30);
    const first = acts[0]; if (!first) throw new Error('no first'); expect(plan.dispatchedActionIds[0]).toBe(first.actionId);
  });

  it('preserves cursor in request', () => {
    const c2 = createSyncCursor('999');
    const plan = planSyncRequest([], c2);
    expect(plan.request.cursor).toBe('999');
  });

  it('reconciles applied -> synced', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    const res: SyncResponse = {
      status: 'ok',
      newCursor: createSyncCursor('100'),
      eventSeq: 100,
      results: ['applied'],
      serverTime: '2026-04-29T00:00:00.000Z',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck([id], res);
    expect(outcome.kind).toBe('ok');
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    {
      expect(outcome.transitions).toHaveLength(1);
      { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('synced'); };
      expect(outcome.newCursor).toBe('100');
    }
  });

  it('reconciles duplicate -> synced (idempotent retry)', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    const res: SyncResponse = {
      status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results: ['duplicate'], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck([id], res);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('synced'); };
  });

  it('reconciles rejected -> rejected', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    const res: SyncResponse = {
      status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results: ['rejected'], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck([id], res);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('rejected'); };
  });

  it('reconciles superseded -> superseded', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    const res: SyncResponse = {
      status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results: ['superseded'], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck([id], res);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('superseded'); };
  });

  it('reconciles awaiting/hint_conflict -> stays pending', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    for (const r of ['awaiting_handoff', 'awaiting_proof', 'hint_conflict'] as const) {
      const res: SyncResponse = {
        status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results: [r], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
      const outcome = reconcileSyncAck([id], res);
      expect(outcome.kind).toBe('ok');
      if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
      { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('pending'); };
    }
  });

  it('returns cursor_expired when server signals expired cursor', () => {
    const id = createActionId('aaaaaaaa-1111-4111-8111-111111111111');
    const res = {
      status: 'cursor_expired', newCursor: createSyncCursor('0'), eventSeq: 0, results: [], serverTime: '', deltas: [], projectionStatus: {}, hysteresisVersion: 0, configFlagVersion: 0,
    } as unknown as SyncResponse;
    const outcome = reconcileSyncAck([id], res);
    expect(outcome.kind).toBe('cursor_expired');
  });

  it('aligns transitions positionally with dispatched ids', () => {
    const ids = [
      createActionId('11111111-1111-4111-8111-111111111111'),
      createActionId('22222222-2222-4222-8222-222222222222'),
      createActionId('33333333-3333-4333-8333-333333333333'),
    ];
    const res: SyncResponse = {
      status: 'ok', newCursor: createSyncCursor('100'), eventSeq: 100,
      results: ['applied', 'rejected', 'duplicate'], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck(ids, res);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok outcome');
    {
      expect(outcome.transitions).toHaveLength(3);
      { const t = outcome.transitions[0]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('synced'); };
      { const t = outcome.transitions[1]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('rejected'); };
      { const t = outcome.transitions[2]; if (!t) throw new Error('no transition'); expect(t.newStatus).toBe('synced'); };
    }
  });

  it('returns protocol_violation when results shorter than dispatched ids', () => {
    const ids = [
      createActionId('11111111-1111-4111-8111-111111111111'),
      createActionId('22222222-2222-4222-8222-222222222222'),
    ];
    const res: SyncResponse = {
      status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results: ['applied'], serverTime: '',
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
    };
    const outcome = reconcileSyncAck(ids, res);
    expect(outcome.kind).toBe('protocol_violation');
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - sync-policy property invariants', () => {
  it('planSyncRequest never produces actions array longer than batchSize', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 100 }),
        (n, batch) => {
          const acts = Array.from({ length: n }, (_, i) => {
            const hex = (i + 1).toString(16).padStart(8, '0');
            return action(`${hex}-1111-4111-8111-111111111111`, i + 1);
          });
          const plan = planSyncRequest(acts, cursor, batch);
          expect(plan.request.actions.length).toBeLessThanOrEqual(batch);
          expect(plan.request.actions.length).toBe(plan.dispatchedActionIds.length);
          return true;
        },
      ),
    );
  });

  it('reconcileSyncAck transition count never exceeds dispatched id count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.constantFrom('applied', 'duplicate', 'rejected', 'superseded', 'awaiting_handoff', 'awaiting_proof', 'hint_conflict' as const), { maxLength: 30 }),
        (idCount, results) => {
          const ids = Array.from({ length: idCount }, (_, i) => {
            const hex = (i + 1).toString(16).padStart(8, '0');
            return createActionId(`${hex}-1111-4111-8111-111111111111`);
          });
          const res: SyncResponse = {
            status: 'ok', newCursor: createSyncCursor('1'), eventSeq: 1, results, serverTime: '',
            deltas: [], projectionStatus: {}, hysteresisVersion: 0, configFlagVersion: 0,
          };
          const outcome = reconcileSyncAck(ids, res);
          if (outcome.kind === 'ok') {
            expect(outcome.transitions.length).toBeLessThanOrEqual(ids.length);
          } else if (outcome.kind === 'protocol_violation') {
            expect(idCount).not.toBe(results.length);
          }
          return true;
        },
      ),
    );
  });

  it('cursor_expired status always propagates regardless of dispatched ids', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        const ids = Array.from({ length: n }, (_, i) => {
          const hex = (i + 1).toString(16).padStart(8, '0');
          return createActionId(`${hex}-1111-4111-8111-111111111111`);
        });
        const res = {
          status: 'cursor_expired', newCursor: createSyncCursor('0'), eventSeq: 0, results: [], serverTime: '',
          deltas: [], projectionStatus: {}, hysteresisVersion: 0, configFlagVersion: 0,
        } as unknown as SyncResponse;
        const outcome = reconcileSyncAck(ids, res);
        return outcome.kind === 'cursor_expired';
      }),
    );
  });
});

describe('@fleet/driver-app - sync-policy batchSize validation', () => {
  it('throws on batchSize = 0', () => {
    expect(() => planSyncRequest([action('aaaaaaaa-1111-4111-8111-111111111111', 1)], cursor, 0)).toThrow(RangeError);
  });
  it('throws on batchSize = -1', () => {
    expect(() => planSyncRequest([], cursor, -1)).toThrow(RangeError);
  });
  it('throws on batchSize = NaN', () => {
    expect(() => planSyncRequest([], cursor, Number.NaN)).toThrow(RangeError);
  });
  it('throws on batchSize = 1.5 (not integer)', () => {
    expect(() => planSyncRequest([], cursor, 1.5)).toThrow(RangeError);
  });

  it('reconcileSyncAck: ill-typed response.status (defensive line 80) returns empty transitions', () => {
    // Simulate a malformed server response where status is neither 'ok' nor
    // 'cursor_expired' (e.g., parsed from JSON without zod validation).
    const malformed = { status: 'wat', newCursor: createSyncCursor('1'), results: [] } as unknown as SyncResponse;
    const outcome = reconcileSyncAck(['a' as never], malformed);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('narrow');
    expect(outcome.transitions).toEqual([]);
  });

  it('reconcileSyncAck: unknown SyncActionResult value triggers the never-exhaustiveness path (lines 120-121)', () => {
    // Force-feed a result value outside the SyncActionResult union to exercise
    // the default branch in mapResultToStatus. Runtime behavior here is
    // intentionally undefined (the `never` returns the value verbatim).
    const actionId = createActionId('22222222-2222-4222-8222-222222222222');
    const malformed = {
      status: 'ok' as const,
      newCursor: createSyncCursor('2'),
      eventSeq: 2,
      results: ['mystery_result' as never],
      deltas: [],
      projectionStatus: {},
      hysteresisVersion: 0,
      configFlagVersion: 0,
      serverTime: '2026-05-13T00:00:00.000Z',
    } satisfies SyncResponse;
    const outcome = reconcileSyncAck([actionId], malformed);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('narrow');
    expect(outcome.transitions).toHaveLength(1);
    // Any value satisfies the runtime contract: the `never` branch returns the
    // unknown result as-is. We assert the actionId pass-through to lock in
    // current behavior; if a future SyncActionResult is added, this test will
    // continue to pass while TS forces the developer to map it explicitly.
    expect(outcome.transitions[0]?.actionId).toBe(actionId);
  });
});
