// apps/driver-app/test/assignments-screen-state.test.ts
// TDD RED: useAssignmentsState hook produces loading/error/empty/loaded states.
import { describe, it, expect, vi } from 'vitest';
import { fetchAssignmentsState, type AssignmentsState } from '../src/assignments/assignments-state.js';
import type { AssignmentRow } from '../src/assignments/assignments-client.js';

function mkClient(rows: AssignmentRow[], err?: Error): { list: ReturnType<typeof vi.fn> } {
  return { list: vi.fn().mockImplementation(() => err ? Promise.reject(err) : Promise.resolve(rows)) };
}

describe('fetchAssignmentsState', () => {
  it('returns loaded state with rows when fetch succeeds', async () => {
    const rows: AssignmentRow[] = [
      { transportOrderId: 'to1', roadRunId: 'r1', state: 'dispatched', plate: null, orderRef: null, customerName: null, pickupName: null, deliveryName: null, plannedStartAt: null, startedAt: null, completedAt: null },
    ];
    const state: AssignmentsState = await fetchAssignmentsState(mkClient(rows) as never);
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') expect(state.rows).toHaveLength(1);
  });

  it('returns empty state when fetch returns no rows', async () => {
    const state = await fetchAssignmentsState(mkClient([]) as never);
    expect(state.kind).toBe('empty');
  });

  it('returns error state with message when fetch rejects', async () => {
    const state = await fetchAssignmentsState(mkClient([], new Error('boom')) as never);
    expect(state.kind).toBe('error');
    if (state.kind === 'error') expect(state.message).toBe('boom');
  });

  it('returns error state for non-Error rejections', async () => {
    const client = { list: vi.fn().mockRejectedValue('string-failure') };
    const state = await fetchAssignmentsState(client as never);
    expect(state.kind).toBe('error');
    if (state.kind === 'error') expect(state.message).toBe('string-failure');
  });
});
