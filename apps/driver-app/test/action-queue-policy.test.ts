// apps/driver-app/test/action-queue-policy.test.ts
// Pure-function tests for local action queue logic.
import { describe, it, expect } from 'vitest';
import {
  nextSequence,
  dispatchableActions,
  isSupersededByServer,
  type QueueableAction,
} from '../src/storage/action-queue-policy.js';

function action(overrides: Partial<QueueableAction> = {}): QueueableAction {
  return {
    actionId: 'a1',
    aggregateType: 'manifest',
    aggregateId: 'agg-1',
    sequence: 1,
    status: 'pending',
    blockedByActionId: null,
    ...overrides,
  };
}

describe('@fleet/driver-app - nextSequence', () => {
  it('returns 1 for empty queue', () => {
    expect(nextSequence([], 'agg-1')).toBe(1);
  });

  it('returns max+1 for existing aggregate', () => {
    const queue = [
      action({ actionId: 'a1', sequence: 1 }),
      action({ actionId: 'a2', sequence: 5 }),
    ];
    expect(nextSequence(queue, 'agg-1')).toBe(6);
  });

  it('starts fresh per aggregate', () => {
    const queue = [
      action({ actionId: 'a1', aggregateId: 'agg-1', sequence: 9 }),
      action({ actionId: 'a2', aggregateId: 'agg-2', sequence: 1 }),
    ];
    expect(nextSequence(queue, 'agg-2')).toBe(2);
    expect(nextSequence(queue, 'agg-3')).toBe(1);
  });
});

describe('@fleet/driver-app - dispatchableActions', () => {
  it('returns only pending actions', () => {
    const queue = [
      action({ actionId: 'a1', status: 'pending' }),
      action({ actionId: 'a2', status: 'synced' }),
      action({ actionId: 'a3', status: 'rejected' }),
    ];
    expect(dispatchableActions(queue)).toHaveLength(1);
    expect(dispatchableActions(queue)[0]?.actionId).toBe('a1');
  });

  it('blocks action when its dependency is not yet synced', () => {
    const queue = [
      action({ actionId: 'a1', status: 'pending' }),
      action({ actionId: 'a2', status: 'pending', blockedByActionId: 'a1' }),
    ];
    const out = dispatchableActions(queue);
    expect(out.map((a) => a.actionId)).toEqual(['a1']);
  });

  it('unblocks when dependency reaches synced status', () => {
    const queue = [
      action({ actionId: 'a1', status: 'synced' }),
      action({ actionId: 'a2', status: 'pending', blockedByActionId: 'a1' }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual(['a2']);
  });

  it('orders by (aggregateId, sequence) ascending', () => {
    const queue = [
      action({ actionId: 'a1', aggregateId: 'agg-2', sequence: 1 }),
      action({ actionId: 'a2', aggregateId: 'agg-1', sequence: 2 }),
      action({ actionId: 'a3', aggregateId: 'agg-1', sequence: 1 }),
    ];
    expect(dispatchableActions(queue).map((a) => a.actionId)).toEqual(['a3', 'a2', 'a1']);
  });

  it('does not mutate the input array', () => {
    const queue = [
      action({ actionId: 'a1', sequence: 2 }),
      action({ actionId: 'a2', sequence: 1 }),
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
