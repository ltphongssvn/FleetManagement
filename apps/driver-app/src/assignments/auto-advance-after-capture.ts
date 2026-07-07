// apps/driver-app/src/assignments/auto-advance-after-capture.ts
// Fire-and-forget bridge (driver-min-interaction arc): a successful photo
// upload auto-fires the derived lifecycle intent through the forgiving
// factory. Pure + React-free; the capture screen calls this after UPLOAD_OK.
// Errors are SWALLOWED by design: the photo flow must never be blocked or
// bannered by the auto-advance -- the assignments list refetch shows truth,
// its manual button remains the fallback, and the server (event-sourced
// pipeline + manifest gate) stays authoritative. Returns the fired kind so
// callers/tests can observe what was attempted.
import { captureProgressIntent } from './capture-progress-policy.js';
import type { LifecycleMutationInput } from './assignments-query.js';
import type { TransitionResult } from './delivery-lifecycle-client.js';

export interface CaptureAdvanceContext {
  readonly roadRunId: string;
  /** Run state as last seen on the assignments list. */
  readonly runState: string;
  /** Stops WITHOUT a committed photo before this upload succeeded. */
  readonly remainingBeforeThisUpload: number;
}

export async function autoAdvanceAfterCapture(
  ctx: CaptureAdvanceContext,
  lifecycleFn: (input: LifecycleMutationInput) => Promise<TransitionResult>,
): Promise<'start' | 'complete' | null> {
  const kind = captureProgressIntent(ctx.runState, ctx.remainingBeforeThisUpload);
  if (kind === null) return null;
  try {
    await lifecycleFn({ roadRunId: ctx.roadRunId, kind });
  } catch {
    // Best-effort only: forgiving recovery already ran inside lifecycleFn;
    // anything still failing (network, MANIFESTS_INCOMPLETE miscount) is the
    // server's truth and surfaces on the next list refetch.
  }
  return kind;
}
