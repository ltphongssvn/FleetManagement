// apps/driver-app/test/action-queue-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { testActionId, testAggregateId } from '@fleet/test-fixtures';
import {
  nextSequence,
  dispatchableActions,
  isSupersededByServer,
  type QueueableAction,
  type ActionStatus,
} from '../src/storage/action-queue-policy.js';

function action(overrides: Partial<QueueableAction> = {}): QueueableAction {
  return {
    actionId: testActionId('a1'),
    aggregateType: 'manifest',
    aggregateId: testAggregateId('agg-1'),
    sequence: 1,
    status: 'pending',
    blockedByActionId: null,
    ...overrides,
  };
}

describe('@fleet/driver-app - nextSequence', () => {
  it('returns 1 for empty queue', () => {
    expect(nextSequence([], testAggregateId('agg-1'))).toBe(1);
  });

  it('returns max+1 for existing aggregate', () => {
    const queue = [
      action({ actionId: testActionId('a1'), sequence: 1 }),
      action({ actionId: testActionId('a2'), sequence: 5 }),
    ];
    expect(nextSequence(queue, testAggregateId('agg-1'))).toBe(6);
  });

  it('starts fresh per aggregate', () => {
    const queue = [
      action({ actionId: testActionId('a1'), aggregateId: testAggregateId('agg-1'), sequence: 9 }),
      action({ actionId: testActionId('a2'), aggregateId: testAggregateId('agg-2'), sequence: 1 }),
    ];
    expect(nextSequence(queue, testAggregateId('agg-2'))).toBe(2);
    expect(nextSequence(queue, testAggregateId('agg-3'))).toBe(1);
  });
});

describe('@fleet/driver-app - dispatchableActions', () => {
  it('returns only pending actions', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'pending',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'synced',
      }),
      action({
        actionId: testActionId('a3'),
        aggregateId: testAggregateId('agg-3'),
        status: 'rejected',
      }),
    ];
    const out = dispatchableActions(queue);
    expect(out).toHaveLength(1);
    expect(out[0]?.actionId).toBe(testActionId('a1'));
  });

  it('blocks action when its dependency is not yet synced', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'pending',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'pending',
        blockedByActionId: testActionId('a1'),
      }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([testActionId('a1')]);
  });

  it('unblocks when dependency reaches synced status', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'synced',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'pending',
        blockedByActionId: testActionId('a1'),
      }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([testActionId('a2')]);
  });

  it('keeps blocking when dependency is in syncing (not yet synced)', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'syncing',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'pending',
        blockedByActionId: testActionId('a1'),
      }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when dependency is rejected (not synced)', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'rejected',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'pending',
        blockedByActionId: testActionId('a1'),
      }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when dependency is superseded', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'superseded',
      }),
      action({
        actionId: testActionId('a2'),
        aggregateId: testAggregateId('agg-2'),
        status: 'pending',
        blockedByActionId: testActionId('a1'),
      }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when blockedByActionId references a missing action', () => {
    const queue = [
      action({
        actionId: testActionId('a1'),
        aggregateId: testAggregateId('agg-1'),
        status: 'pending',
        blockedByActionId: testActionId('does-not-exist'),
      }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('returns only head-of-line per aggregate (lowest pending sequence)', () => {
    const queue = [
      action({ actionId: testActionId('a1'), aggregateId: testAggregateId('agg-1'), sequence: 1 }),
      action({ actionId: testActionId('a2'), aggregateId: testAggregateId('agg-1'), sequence: 2 }),
      action({ actionId: testActionId('a3'), aggregateId: testAggregateId('agg-1'), sequence: 3 }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([testActionId('a1')]);
  });

  it('resolves chains across sync cycles, not in a single pass (1-level by design)', () => {
    const a = testActionId('A');
    const b = testActionId('B');
    const c = testActionId('C');
    const cycle1: QueueableAction[] = [
      action({ actionId: a, aggregateId: testAggregateId('ag-A'), status: 'pending' }),
      action({
        actionId: b,
        aggregateId: testAggregateId('ag-B'),
        status: 'pending',
        blockedByActionId: a,
      }),
      action({
        actionId: c,
        aggregateId: testAggregateId('ag-C'),
        status: 'pending',
        blockedByActionId: b,
      }),
    ];
    expect(dispatchableActions(cycle1).map((x) => x.actionId)).toEqual([a]);
    const cycle2 = cycle1.map(
      (x): QueueableAction => (x.actionId === a ? { ...x, status: 'synced' } : x),
    );
    expect(dispatchableActions(cycle2).map((x) => x.actionId)).toEqual([b]);
    const cycle3 = cycle2.map(
      (x): QueueableAction => (x.actionId === b ? { ...x, status: 'synced' } : x),
    );
    expect(dispatchableActions(cycle3).map((x) => x.actionId)).toEqual([c]);
  });

  it('orders heads by aggregateId ascending', () => {
    const queue = [
      action({ actionId: testActionId('a1'), aggregateId: testAggregateId('agg-2'), sequence: 1 }),
      action({ actionId: testActionId('a2'), aggregateId: testAggregateId('agg-1'), sequence: 1 }),
    ];
    // The property is ASCENDING ORDER, not label order. Ids are minted from
    // labels now, so 'agg-1' does not necessarily sort before 'agg-2' -- the
    // old assertion only held because the raw labels happened to sort that way,
    // which was never what dispatchableActions guarantees.
    const ordered = dispatchableActions(queue).map((a) => a.aggregateId);
    expect(ordered).toEqual([...ordered].sort((x, y) => x.localeCompare(y)));
    expect(ordered).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const queue = [
      action({ actionId: testActionId('a1'), aggregateId: testAggregateId('agg-1'), sequence: 2 }),
      action({ actionId: testActionId('a2'), aggregateId: testAggregateId('agg-2'), sequence: 1 }),
    ];
    const snapshot = queue.map((a) => a.actionId);
    dispatchableActions(queue);
    expect(queue.map((a) => a.actionId)).toEqual(snapshot);
  });
});

describe('@fleet/driver-app - isSupersededByServer', () => {
  it('returns true only for superseded result', () => {
    expect(isSupersededByServer('superseded')).toBe(true);
    expect(isSupersededByServer('applied')).toBe(false);
    expect(isSupersededByServer('duplicate')).toBe(false);
    expect(isSupersededByServer('rejected')).toBe(false);
    expect(isSupersededByServer('awaiting_handoff')).toBe(false);
  });
});

describe('@fleet/driver-app - dispatchableActions (property-based)', () => {
  const STATUSES: readonly ActionStatus[] = [
    'pending',
    'syncing',
    'synced',
    'rejected',
    'superseded',
  ];

  const arbAction = fc.record({
    actionId: fc.uuid().map(testActionId),
    aggregateType: fc.constant('manifest'),
    aggregateId: fc.integer({ min: 0, max: 9 }).map((n) => testAggregateId(`agg-${String(n)}`)),
    sequence: fc.integer({ min: 1, max: 1000 }),
    status: fc.constantFrom(...STATUSES),
    blockedByActionId: fc.constant(null),
  });

  it('output length never exceeds input length', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        return dispatchableActions(actions).length <= actions.length;
      }),
    );
  });

  it('output contains only pending actions', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        return dispatchableActions(actions).every((a) => a.status === 'pending');
      }),
    );
  });

  it('output is sorted by aggregateId', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        const out = dispatchableActions(actions);
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1];
          const cur = out[i];
          if (!prev || !cur) continue;
          if (prev.aggregateId.localeCompare(cur.aggregateId) > 0) return false;
        }
        return true;
      }),
    );
  });

  it('returns at most one action per aggregateId (head-of-line)', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        const out = dispatchableActions(actions);
        const seen = new Set<string>();
        for (const a of out) {
          if (seen.has(a.aggregateId)) return false;
          seen.add(a.aggregateId);
        }
        return true;
      }),
    );
  });

  it('does not mutate the input', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        const snapshot = actions.map((a) => a.actionId);
        dispatchableActions(actions);
        return actions.every((a, i) => a.actionId === snapshot[i]);
      }),
    );
  });
});

describe('@fleet/driver-app - action-queue-policy mutation-hardening', () => {
  it('dispatchableActions picks LOWEST sequence as head-of-line even when actions arrive out of order (kills L43 a.sequence < current.sequence -> false mutant)', () => {
    // Original L43: if (!current || a.sequence < current.sequence) → keeps lowest seq.
    // Mutated `!current || false`: only sets head on FIRST encounter (when current is undefined).
    //   So if seq:5 is first and seq:1 is second for the same aggregate, mutated picks seq:5.
    //   Original picks seq:1.
    // Construct input out-of-order: [seq:5, seq:1] same aggregateId, both pending.
    const aggregateId = '11111111-1111-4111-8111-111111111111';
    const result = dispatchableActions([
      {
        actionId: '22222222-2222-4222-8222-222222222222',
        aggregateType: 'transport_order',
        aggregateId,
        payload: {},
        status: 'pending',
        sequence: 5,
        blockedByActionId: null,
      },
      {
        actionId: '33333333-3333-4333-8333-333333333333',
        aggregateType: 'transport_order',
        aggregateId,
        payload: {},
        status: 'pending',
        sequence: 1,
        blockedByActionId: null,
      },
    ] as never);
    expect(result).toHaveLength(1);
    expect(result[0]?.sequence).toBe(1);
  });

  it('dispatchableActions does NOT swap heads when sequences are equal (kills L43 < -> <= mutant)', () => {
    // Original: `a.sequence < current.sequence` is false when equal → keeps first seen.
    // Mutated `<=`: true when equal → swaps to later. Different actionId picked.
    // Sequences should be unique per aggregate in production, but the policy must
    // behave deterministically for testing purposes.
    const aggregateId = '11111111-1111-4111-8111-111111111111';
    const result = dispatchableActions([
      {
        actionId: '22222222-2222-4222-8222-222222222222',
        aggregateType: 'transport_order',
        aggregateId,
        payload: {},
        status: 'pending',
        sequence: 1,
        blockedByActionId: null,
      },
      {
        actionId: '33333333-3333-4333-8333-333333333333',
        aggregateType: 'transport_order',
        aggregateId,
        payload: {},
        status: 'pending',
        sequence: 1,
        blockedByActionId: null,
      },
    ] as never);
    expect(result).toHaveLength(1);
    // Original keeps the FIRST seen action with the lowest seq (here, seq=1 first one).
    expect(result[0]?.actionId).toBe('22222222-2222-4222-8222-222222222222');
  });
});
