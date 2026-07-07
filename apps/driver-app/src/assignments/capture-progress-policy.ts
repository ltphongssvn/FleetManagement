// apps/driver-app/src/assignments/capture-progress-policy.ts
// Pure policy for the driver-min-interaction arc: drivers under road pressure
// should not tap lifecycle buttons -- the PHOTO is the signal. After a
// successful manifest upload, decide which lifecycle intent to auto-fire
// through the forgiving factory (makeForgivingLifecycleMutationFn, PR #235):
//   planned|dispatched + stops remain  -> 'start'    (first photo proves the
//                                          trip is underway; the forgiving
//                                          walk supplies the missing accept)
//   any non-terminal + LAST stop done  -> 'complete' (walk supplies
//                                          accept/start; the SERVER manifest
//                                          gate stays authoritative and will
//                                          409 MANIFESTS_INCOMPLETE if the
//                                          client miscounted)
//   started + stops remain             -> null
//   terminal/unknown/bad counts        -> null (never guess)
// remainingBeforeThisUpload counts the stops WITHOUT a committed photo as of
// the assignments list the driver is looking at (presentAssignmentStops
// st.done), BEFORE this upload succeeded. 1 therefore means "this photo was
// the last one". Client intent is best-effort only; the server re-validates
// every transition through the event-sourced pipeline.
export type CaptureProgressIntent = 'start' | 'complete';

const STARTABLE = new Set(['planned', 'dispatched']);
const NON_TERMINAL = new Set(['planned', 'dispatched', 'started']);

export function captureProgressIntent(
  state: string,
  remainingBeforeThisUpload: number,
): CaptureProgressIntent | null {
  if (!Number.isInteger(remainingBeforeThisUpload) || remainingBeforeThisUpload < 1) {
    return null;
  }
  const s = state.toLowerCase();
  if (!NON_TERMINAL.has(s)) return null;
  if (remainingBeforeThisUpload === 1) return 'complete';
  return STARTABLE.has(s) ? 'start' : null;
}
