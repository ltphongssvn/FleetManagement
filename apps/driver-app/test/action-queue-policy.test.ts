// apps/driver-app/test/action-queue-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createActionId, createAggregateId } from '@fleet/sync-protocol';
import {
  nextSequence,
  dispatchableActions,
  isSupersededByServer,
  type QueueableAction,
  type ActionStatus,
} from '../src/storage/action-queue-policy.js';

function action(overrides: Partial<QueueableAction> = {}): QueueableAction {
  return {
    actionId: createActionId('a1'),
    aggregateType: 'manifest',
    aggregateId: createAggregateId('agg-1'),
    sequence: 1,
    status: 'pending',
    blockedByActionId: null,
    ...overrides,
  };
}

describe('@fleet/driver-app - nextSequence', () => {
  it('returns 1 for empty queue', () => {
    expect(nextSequence([], createAggregateId('agg-1'))).toBe(1);
  });

  it('returns max+1 for existing aggregate', () => {
    const queue = [
      action({ actionId: createActionId('a1'), sequence: 1 }),
      action({ actionId: createActionId('a2'), sequence: 5 }),
    ];
    expect(nextSequence(queue, createAggregateId('agg-1'))).toBe(6);
  });

  it('starts fresh per aggregate', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), sequence: 9 }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), sequence: 1 }),
    ];
    expect(nextSequence(queue, createAggregateId('agg-2'))).toBe(2);
    expect(nextSequence(queue, createAggregateId('agg-3'))).toBe(1);
  });
});

describe('@fleet/driver-app - dispatchableActions', () => {
  it('returns only pending actions', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'pending' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'synced' }),
      action({ actionId: createActionId('a3'), aggregateId: createAggregateId('agg-3'), status: 'rejected' }),
    ];
    const out = dispatchableActions(queue);
    expect(out).toHaveLength(1);
    expect(out[0]?.actionId).toBe(createActionId('a1'));
  });

  it('blocks action when its dependency is not yet synced', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'pending' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([createActionId('a1')]);
  });

  it('unblocks when dependency reaches synced status', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'synced' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([createActionId('a2')]);
  });

  it('keeps blocking when dependency is in syncing (not yet synced)', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'syncing' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when dependency is rejected (not synced)', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'rejected' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when dependency is superseded', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'superseded' }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('keeps blocking when blockedByActionId references a missing action', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), status: 'pending', blockedByActionId: createActionId('does-not-exist') }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(0);
  });

  it('returns only head-of-line per aggregate (lowest pending sequence)', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), sequence: 1 }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-1'), sequence: 2 }),
      action({ actionId: createActionId('a3'), aggregateId: createAggregateId('agg-1'), sequence: 3 }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([createActionId('a1')]);
  });

  it('resolves chains across sync cycles, not in a single pass (1-level by design)', () => {
    const a = createActionId('A');
    const b = createActionId('B');
    const c = createActionId('C');
    const cycle1: QueueableAction[] = [
      action({ actionId: a, aggregateId: createAggregateId('ag-A'), status: 'pending' }),
      action({ actionId: b, aggregateId: createAggregateId('ag-B'), status: 'pending', blockedByActionId: a }),
      action({ actionId: c, aggregateId: createAggregateId('ag-C'), status: 'pending', blockedByActionId: b }),
    ];
    expect(dispatchableActions(cycle1).map((x) => x.actionId)).toEqual([a]);
    const cycle2 = cycle1.map((x): QueueableAction => (x.actionId === a ? { ...x, status: 'synced' } : x));
    expect(dispatchableActions(cycle2).map((x) => x.actionId)).toEqual([b]);
    const cycle3 = cycle2.map((x): QueueableAction => (x.actionId === b ? { ...x, status: 'synced' } : x));
    expect(dispatchableActions(cycle3).map((x) => x.actionId)).toEqual([c]);
  });

  it('orders heads by aggregateId ascending', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-2'), sequence: 1 }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-1'), sequence: 1 }),
    ];
    expect(dispatchableActions(queue).map((a) => a.aggregateId)).toEqual([
      createAggregateId('agg-1'),
      createAggregateId('agg-2'),
    ]);
  });

  it('does not mutate the input array', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-1'), sequence: 2 }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-2'), sequence: 1 }),
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
  const STATUSES: readonly ActionStatus[] = ['pending', 'syncing', 'synced', 'rejected', 'superseded'];

  const arbAction = fc.record({
    actionId: fc.uuid().map(createActionId),
    aggregateType: fc.constant('manifest'),
    aggregateId: fc.integer({ min: 0, max: 9 }).map((n) => createAggregateId(`agg-${String(n)}`)),
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
