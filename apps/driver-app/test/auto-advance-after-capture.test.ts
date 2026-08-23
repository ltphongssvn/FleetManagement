// apps/driver-app/test/auto-advance-after-capture.test.ts
// RED-first (driver-min-interaction arc, U2): the fire-and-forget bridge from
// a successful photo upload to the forgiving lifecycle. Pure + React-free:
// takes the capture context (roadRunId, run state, stops remaining BEFORE the
// upload) and a lifecycle mutation fn (the forgiving factory output), derives
// the intent via captureProgressIntent, fires it, and SWALLOWS every error --
// the photo flow must never be blocked or bannered by the auto-advance; the
// assignments list refetch shows truth and its manual button remains the
// fallback. Returns the fired kind (or null) so callers/tests can observe.
// Fails at import resolution until auto-advance-after-capture.ts lands.
import { describe, it, expect, vi } from 'vitest';
import { autoAdvanceAfterCapture } from '../src/assignments/auto-advance-after-capture.js';
import type { LifecycleMutationInput } from '../src/assignments/assignments-query.js';
import type { TransitionResult } from '../src/assignments/delivery-lifecycle-client.js';

function fnResolving(): {
  fn: (i: LifecycleMutationInput) => Promise<TransitionResult>;
  calls: LifecycleMutationInput[];
} {
  const calls: LifecycleMutationInput[] = [];
  return {
    calls,
    fn: (i) => {
      calls.push(i);
      return Promise.resolve({ roadRunId: i.roadRunId, state: 'started' });
    },
  };
}

describe('autoAdvanceAfterCapture', () => {
  it('fires start for a first photo on a planned run', async () => {
    const { fn, calls } = fnResolving();
    const fired = await autoAdvanceAfterCapture(
      { roadRunId: 'rr-1', runState: 'planned', remainingBeforeThisUpload: 2 },
      fn,
    );
    expect(fired).toBe('start');
    expect(calls).toEqual([{ roadRunId: 'rr-1', kind: 'start' }]);
  });

  it('fires complete when this photo was the last remaining stop', async () => {
    const { fn, calls } = fnResolving();
    const fired = await autoAdvanceAfterCapture(
      { roadRunId: 'rr-2', runState: 'started', remainingBeforeThisUpload: 1 },
      fn,
    );
    expect(fired).toBe('complete');
    expect(calls).toEqual([{ roadRunId: 'rr-2', kind: 'complete' }]);
  });

  it('no-ops (null) when the policy yields no intent', async () => {
    const { fn, calls } = fnResolving();
    const fired = await autoAdvanceAfterCapture(
      { roadRunId: 'rr-3', runState: 'started', remainingBeforeThisUpload: 3 },
      fn,
    );
    expect(fired).toBeNull();
    expect(calls).toEqual([]);
  });

  it('swallows lifecycle errors and still reports the fired kind', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('MANIFESTS_INCOMPLETE or network')));
    const fired = await autoAdvanceAfterCapture(
      { roadRunId: 'rr-4', runState: 'planned', remainingBeforeThisUpload: 1 },
      fn,
    );
    expect(fired).toBe('complete');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('never fires for terminal or unknown states', async () => {
    const { fn, calls } = fnResolving();
    expect(
      await autoAdvanceAfterCapture(
        { roadRunId: 'rr-5', runState: 'cancelled', remainingBeforeThisUpload: 1 },
        fn,
      ),
    ).toBeNull();
    expect(
      await autoAdvanceAfterCapture(
        { roadRunId: 'rr-5', runState: 'weird', remainingBeforeThisUpload: 2 },
        fn,
      ),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
