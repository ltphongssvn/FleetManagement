// apps/driver-app/test/assignments-query.test.ts
// TDD RED: the pure, React-free pieces of the assignments TanStack Query —
// the cache key, the list queryFn factory, and the lifecycle mutation
// factory that dispatches accept/start/complete. The useQuery/useMutation
// hook (use-assignments.tsx) is a thin React wrapper, excluded from coverage
// like use-auth.tsx; all testable logic lives here.
import { describe, it, expect, vi } from 'vitest';
import {
  ASSIGNMENTS_QUERY_KEY,
  makeAssignmentsQueryFn,
  makeLifecycleMutationFn,
} from '../src/assignments/assignments-query.js';
import type { AssignmentRow } from '../src/assignments/assignments-client.js';
describe('ASSIGNMENTS_QUERY_KEY', () => {
  it('is a stable array key for the assignments cache entry', () => {
    expect(ASSIGNMENTS_QUERY_KEY).toEqual(['assignments']);
  });
});
describe('makeAssignmentsQueryFn', () => {
  it('returns a function that calls the client list method', async () => {
    const rows: AssignmentRow[] = [];
    const list = vi.fn().mockResolvedValue(rows);
    const queryFn = makeAssignmentsQueryFn({ list } as never);
    const result = await queryFn();
    expect(list).toHaveBeenCalledOnce();
    expect(result).toBe(rows);
  });
  it('propagates a rejection from the client', async () => {
    const list = vi.fn().mockRejectedValue(new Error('network'));
    const queryFn = makeAssignmentsQueryFn({ list } as never);
    await expect(queryFn()).rejects.toThrow('network');
  });
});
describe('makeLifecycleMutationFn', () => {
  it('dispatches accept to the client accept method', async () => {
    const accept = vi.fn().mockResolvedValue({ roadRunId: 'r1', state: 'dispatched' });
    const start = vi.fn();
    const complete = vi.fn();
    const mutate = makeLifecycleMutationFn({ accept, start, complete } as never);
    const result = await mutate({ roadRunId: 'r1', kind: 'accept' });
    expect(accept).toHaveBeenCalledWith('r1');
    expect(start).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(result.state).toBe('dispatched');
  });
  it('dispatches start to the client start method', async () => {
    const accept = vi.fn();
    const start = vi.fn().mockResolvedValue({ roadRunId: 'r2', state: 'started' });
    const complete = vi.fn();
    const mutate = makeLifecycleMutationFn({ accept, start, complete } as never);
    await mutate({ roadRunId: 'r2', kind: 'start' });
    expect(start).toHaveBeenCalledWith('r2');
    expect(accept).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it('dispatches complete to the client complete method', async () => {
    const accept = vi.fn();
    const start = vi.fn();
    const complete = vi.fn().mockResolvedValue({ roadRunId: 'r3', state: 'completed' });
    const mutate = makeLifecycleMutationFn({ accept, start, complete } as never);
    await mutate({ roadRunId: 'r3', kind: 'complete' });
    expect(complete).toHaveBeenCalledWith('r3');
    expect(accept).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('propagates a rejection from the underlying transition', async () => {
    const accept = vi.fn().mockRejectedValue(new Error('invalid_state'));
    const mutate = makeLifecycleMutationFn({ accept, start: vi.fn(), complete: vi.fn() } as never);
    await expect(mutate({ roadRunId: 'r1', kind: 'accept' })).rejects.toThrow('invalid_state');
  });
});
