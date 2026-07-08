// apps/driver-app/test/forgiving-lifecycle.test.ts
// RED-first (forgiving-FSM arc, consumer side): when a lifecycle action is
// rejected 409 INVALID_STATE_TRANSITION, the structured extensions
// { currentState, allowedActions } let the client RECOVER instead of just
// showing a banner:
//   - target already reached/passed on the linear happy path (planned
//     dispatched < started < completed): treat as idempotent success and
//     return { roadRunId, state: currentState } -- the list refetch shows
//     truth (driver double-tap, offline replay of an already-applied step).
//   - target ahead and every missing intermediate action is allowed: WALK
//     the ladder (accept -> start -> complete), auto-recording the step the
//     driver skipped (tapped Hoan thanh with photos but forgot Bat dau).
//     The server manifest gate still guards complete (MANIFESTS_INCOMPLETE
//     surfaces normally if photos are missing).
//   - anything else (cancelled, unknown states, missing extensions,
//     non-IST errors): rethrow the ORIGINAL error -- presenter banner today.
// Fails at import resolution until forgiving-lifecycle.ts lands.
import { describe, it, expect, vi } from 'vitest';
import { parseProblemDetails } from '@fleet/sync-protocol';
import { ApiError } from '../src/errors/api-error.js';
import {
  makeForgivingLifecycleMutationFn,
  planRecovery,
} from '../src/assignments/forgiving-lifecycle.js';
import type { LifecycleSource } from '../src/assignments/assignments-query.js';
import type { TransitionResult } from '../src/assignments/delivery-lifecycle-client.js';

function istError(currentState: string, allowedActions: readonly string[]): ApiError {
  return ApiError.fromBody(409, {
    title: 'Conflict', status: 409,
    detail: 'Khong the thuc hien thao tac.',
    instance: '/x', code: 'INVALID_STATE_TRANSITION',
    currentState, allowedActions,
  });
}

function clientWhere(states: Record<string, () => Promise<TransitionResult>>): LifecycleSource {
  return {
    accept: states['accept'] ?? vi.fn(),
    start: states['start'] ?? vi.fn(),
    complete: states['complete'] ?? vi.fn(),
  } as unknown as LifecycleSource;
}

describe('forgiving lifecycle recovery', () => {
  it('sanity: the 409 envelope round-trips extensions through ApiError.problem', () => {
    const err = istError('dispatched', ['started', 'cancelled']);
    expect(parseProblemDetails(err.problem)).not.toBeNull();
    expect((err.problem as Record<string, unknown>)['currentState']).toBe('dispatched');
  });

  it('walks the ladder: complete on dispatched -> auto start, then complete', async () => {
    const calls: string[] = [];
    const client = clientWhere({
      start: vi.fn(async () => { await Promise.resolve(); calls.push('start'); return { roadRunId: 'rr', state: 'started' }; }),
      complete: vi.fn(() => {
        calls.push('complete');
        if (calls.filter((c) => c === 'complete').length === 1) throw istError('dispatched', ['started', 'cancelled']);
        return Promise.resolve({ roadRunId: 'rr', state: 'completed' });
      }),
    });
    const fn = makeForgivingLifecycleMutationFn(client);
    const out = await fn({ roadRunId: 'rr', kind: 'complete' });
    expect(out).toEqual({ roadRunId: 'rr', state: 'completed' });
    expect(calls).toEqual(['complete', 'start', 'complete']);
  });

  it('walks two rungs: complete on planned -> accept, start, complete', async () => {
    const calls: string[] = [];
    const client = clientWhere({
      accept: vi.fn(async () => { await Promise.resolve(); calls.push('accept'); return { roadRunId: 'rr', state: 'dispatched' }; }),
      start: vi.fn(async () => { await Promise.resolve(); calls.push('start'); return { roadRunId: 'rr', state: 'started' }; }),
      complete: vi.fn(() => {
        calls.push('complete');
        if (calls.filter((c) => c === 'complete').length === 1) throw istError('planned', ['dispatched', 'cancelled']);
        return Promise.resolve({ roadRunId: 'rr', state: 'completed' });
      }),
    });
    const out = await makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'complete' });
    expect(out.state).toBe('completed');
    expect(calls).toEqual(['complete', 'accept', 'start', 'complete']);
  });

  it('treats an already-passed target as idempotent success', async () => {
    const client = clientWhere({
      accept: vi.fn(() => { throw istError('started', ['completed', 'cancelled']); }),
    });
    const out = await makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'accept' });
    expect(out).toEqual({ roadRunId: 'rr', state: 'started' });
  });

  it('rethrows the ORIGINAL error when the run is cancelled (no path)', async () => {
    const original = istError('cancelled', []);
    const client = clientWhere({
      complete: vi.fn(() => { throw original; }),
    });
    await expect(makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'complete' }))
      .rejects.toBe(original);
  });

  it('rethrows non-IST errors untouched (manifest gate stays a banner)', async () => {
    const original = ApiError.fromBody(409, {
      title: 'Conflict', status: 409, detail: 'Chua du anh.',
      instance: '/x', code: 'MANIFESTS_INCOMPLETE', committed: 1, required: 2,
    });
    const client = clientWhere({
      complete: vi.fn(() => { throw original; }),
    });
    await expect(makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'complete' }))
      .rejects.toBe(original);
  });

  it('rethrows when extensions are absent (legacy envelope)', async () => {
    const original = ApiError.fromBody(409, {
      title: 'Conflict', status: 409, detail: 'x', instance: '/x',
      code: 'INVALID_STATE_TRANSITION',
    });
    const client = clientWhere({
      start: vi.fn(() => { throw original; }),
    });
    await expect(makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'start' }))
      .rejects.toBe(original);
  });

  it('does not loop: a second IST during recovery rethrows it', async () => {
    const second = istError('cancelled', []);
    const client = clientWhere({
      start: vi.fn(() => { throw second; }),
      complete: vi.fn(() => { throw istError('dispatched', ['started', 'cancelled']); }),
    });
    await expect(makeForgivingLifecycleMutationFn(client)({ roadRunId: 'rr', kind: 'complete' }))
      .rejects.toBe(second);
  });
});

describe('planRecovery edge coverage', () => {
  it('returns null for unknown states and disallowed first rungs', () => {
    expect(planRecovery('complete', 'cancelled', [])).toBeNull();
    expect(planRecovery('complete', 'weird', ['dispatched'])).toBeNull();
    expect(planRecovery('complete', 'planned', ['cancelled'])).toBeNull();
  });

  it('plans the exact rung sequences', () => {
    expect(planRecovery('complete', 'planned', ['dispatched', 'cancelled']))
      .toEqual({ outcome: 'walk', steps: ['accept', 'start', 'complete'] });
    expect(planRecovery('start', 'started', []))
      .toEqual({ outcome: 'already-there', state: 'started' });
  });
});
