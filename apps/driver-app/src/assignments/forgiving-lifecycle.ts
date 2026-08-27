// apps/driver-app/src/assignments/forgiving-lifecycle.ts
// Forgiving lifecycle recovery (consumer side of the forgiving-FSM arc).
// Wraps the plain lifecycle mutationFn: when the api rejects an action with
// 409 INVALID_STATE_TRANSITION + { currentState, allowedActions } extensions
// (producer ships them since PR #232), recover instead of bannering:
//   - target already reached/passed on the LINEAR happy path (planned
//     dispatched < started < completed): idempotent success -- return
//     { roadRunId, state: currentState }; the list refetch shows truth.
//     Covers double-taps and offline replay of an already-applied step.
//   - target ahead with every missing rung allowed: WALK the ladder
//     (accept -> start -> complete), auto-recording the step the driver
//     skipped (e.g. tapped Hoan thanh with all photos but forgot Bat dau).
//     The server manifest gate still guards complete: MANIFESTS_INCOMPLETE
//     surfaces normally if photos are missing.
//   - anything else (cancelled, unknown/legacy envelopes, non-IST errors):
//     rethrow the ORIGINAL error so presentApiError banners exactly as
//     today. Recovery never masks a real conflict: a second IST thrown
//     while walking is rethrown, never re-recovered (no loops).
// Pure and React-free like assignments-query.ts; the hook swaps factories.
import { parseInvalidStateTransitionExtensions } from '@fleet/sync-protocol';
import { ApiError } from '../errors/api-error.js';
import type {
  LifecycleKind,
  LifecycleMutationInput,
  LifecycleSource,
} from './assignments-query.js';
import type { TransitionResult } from './delivery-lifecycle-client.js';

// The linear happy path. Index = progress rank; cancelled is deliberately
// absent (no forgiving path into or out of a cancelled run).
const LADDER = ['planned', 'dispatched', 'started', 'completed'] as const;
type LadderState = (typeof LADDER)[number];

// Action that advances FROM the state at the same index.
const ACTION_FROM: Readonly<Record<Exclude<LadderState, 'completed'>, LifecycleKind>> = {
  planned: 'accept',
  dispatched: 'start',
  started: 'complete',
};

// The state each action targets.
const TARGET_OF: Readonly<Record<LifecycleKind, LadderState>> = {
  accept: 'dispatched',
  start: 'started',
  complete: 'completed',
};

function rank(state: string): number {
  return LADDER.indexOf(state as LadderState);
}

function run(
  client: LifecycleSource,
  kind: LifecycleKind,
  roadRunId: string,
): Promise<TransitionResult> {
  if (kind === 'accept') return client.accept(roadRunId);
  if (kind === 'start') return client.start(roadRunId);
  return client.complete(roadRunId);
}

/** Recovery plan for a rejected action, or null when no safe path exists. */
export function planRecovery(
  kind: LifecycleKind,
  currentState: string,
  allowedActions: readonly string[],
):
  | { readonly outcome: 'already-there'; readonly state: string }
  | { readonly outcome: 'walk'; readonly steps: readonly LifecycleKind[] }
  | null {
  const cur = rank(currentState);
  const target = rank(TARGET_OF[kind]);
  if (cur < 0) return null;
  if (cur >= target) return { outcome: 'already-there', state: currentState };
  // Walk cur -> target; every rung's next state must be allowed from where
  // we stand NOW (the server re-validates each step regardless).
  const first = LADDER[cur];
  if (first === undefined || first === 'completed') return null;
  const firstAction = ACTION_FROM[first];
  if (!allowedActions.includes(TARGET_OF[firstAction])) return null;
  const steps: LifecycleKind[] = [];
  for (let i = cur; i < target; i += 1) {
    const from = LADDER[i];
    if (from === undefined || from === 'completed') return null;
    steps.push(ACTION_FROM[from]);
  }
  return { outcome: 'walk', steps };
}

/** Drop-in replacement for makeLifecycleMutationFn with recovery. */
export function makeForgivingLifecycleMutationFn(
  client: LifecycleSource,
): (input: LifecycleMutationInput) => Promise<TransitionResult> {
  return async ({ roadRunId, kind }) => {
    try {
      return await run(client, kind, roadRunId);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'INVALID_STATE_TRANSITION') throw err;
      const ext = parseInvalidStateTransitionExtensions(err.problem);
      if (ext === null) throw err;
      const plan = planRecovery(kind, ext.currentState, ext.allowedActions);
      if (plan === null) throw err;
      if (plan.outcome === 'already-there') {
        return { roadRunId, state: plan.state };
      }
      // Walk the ladder. Any error here -- including a second IST -- is the
      // real state of the world: rethrow, never re-recover.
      let last: TransitionResult = { roadRunId, state: ext.currentState };
      for (const step of plan.steps) {
        last = await run(client, step, roadRunId);
      }
      return last;
    }
  };
}
