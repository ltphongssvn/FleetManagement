// apps/driver-app/test/action-queue-policy.test.ts
// Pure-function tests for local action queue logic.
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
      action({ actionId: createActionId('a1'), status: 'pending' }),
      action({ actionId: createActionId('a2'), status: 'synced' }),
      action({ actionId: createActionId('a3'), status: 'rejected' }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(1);
    expect(dispatchableActions(queue)[0]?.actionId).toBe(createActionId('a1'));
  });

  it('blocks action when its dependency is not yet synced', () => {
    const queue = [
      action({ actionId: createActionId('a1'), status: 'pending' }),
      action({ actionId: createActionId('a2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    const out = dispatchableActions(queue);
    expect(out.map((a) => a.actionId)).toEqual([createActionId('a1')]);
  });

  it('unblocks when dependency reaches synced status', () => {
    const queue = [
      action({ actionId: createActionId('a1'), status: 'synced' }),
      action({ actionId: createActionId('a2'), status: 'pending', blockedByActionId: createActionId('a1') }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([createActionId('a2')]);
  });

  /**
   * PDF design constraint: "blocked_by_action_id for upload->sync only" = 1 level deep.
   * Upload actions have no blocker; only the paired sync action references the upload.
   * This test pins the contract: A->B->C chains are NOT a valid input shape; if they
   * occur, only A dispatches in cycle 1, B dispatches after A is synced (cycle 2),
   * etc. Transitive resolution in a single pass is intentionally NOT supported.
   */
  it('resolves chains across sync cycles, not in a single pass (1-level by design)', () => {
    const a = createActionId('A');
    const b = createActionId('B');
    const c = createActionId('C');
    const cycle1 = [
      action({ actionId: a, aggregateId: createAggregateId('ag-A'), status: 'pending' }),
      action({ actionId: b, aggregateId: createAggregateId('ag-B'), status: 'pending', blockedByActionId: a }),
      action({ actionId: c, aggregateId: createAggregateId('ag-C'), status: 'pending', blockedByActionId: b }),
    ];
    expect(dispatchableActions(cycle1).map((x) => x.actionId)).toEqual([a]);

    // After A is synced, B becomes dispatchable; C still blocked.
    const cycle2 = cycle1.map((x): QueueableAction => (x.actionId === a ? { ...x, status: 'synced' } : x));
    expect(dispatchableActions(cycle2).map((x) => x.actionId)).toEqual([b]);

    // After B is synced, C becomes dispatchable.
    const cycle3 = cycle2.map((x): QueueableAction => (x.actionId === b ? { ...x, status: 'synced' } : x));
    expect(dispatchableActions(cycle3).map((x) => x.actionId)).toEqual([c]);
  });

  it('orders by (aggregateId, sequence) ascending', () => {
    const queue = [
      action({ actionId: createActionId('a1'), aggregateId: createAggregateId('agg-2'), sequence: 1 }),
      action({ actionId: createActionId('a2'), aggregateId: createAggregateId('agg-1'), sequence: 2 }),
      action({ actionId: createActionId('a3'), aggregateId: createAggregateId('agg-1'), sequence: 1 }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual([
      createActionId('a3'),
      createActionId('a2'),
      createActionId('a1'),
    ]);
  });

  it('does not mutate the input array', () => {
    const queue = [
      action({ actionId: createActionId('a1'), sequence: 2 }),
      action({ actionId: createActionId('a2'), sequence: 1 }),
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

  it('output is sorted by (aggregateId, sequence)', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 50 }), (actions) => {
        const out = dispatchableActions(actions);
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1];
          const cur = out[i];
          if (!prev || !cur) continue;
          if (prev.aggregateId === cur.aggregateId) {
            if (prev.sequence > cur.sequence) return false;
          } else if (prev.aggregateId.localeCompare(cur.aggregateId) > 0) {
            return false;
          }
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
