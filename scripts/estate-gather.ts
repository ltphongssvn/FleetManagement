// scripts/estate-gather.ts
// TURNING FOUR GIT COMMAND OUTCOMES INTO ONE WORKTREE STATE, purely.
//
// THE DEFECT THIS CLOSES. gatherOne called a helper that swallowed the exit
// code and returned '' on failure, and countLines('') is 0. So a failed
// `git status --porcelain` read as a CLEAN working tree, and a failed
// `git stash list` read as NO STASHES. The schema cannot catch it, because 0 is
// a perfectly valid count -- the value is well-formed and simply false.
//
// That is the confident zero this task exists to refuse, reachable inside the
// task itself. 2026 has the same bug documented repeatedly: Gitaly logged OK
// when the forked git process exited non-zero, and scip-java returned a
// successful exit code without producing its output. The lesson is identical --
// an ignored exit code turns a failure into a success.
//
// EMPTY IS NOT THE SAME AS FAILED, so the outcome is a discriminated union
// rather than a string. A command that ran and printed nothing is a fact; a
// command that could not run is an absence of fact, and the two must not share
// a representation.
//
// PURE, so the whole mapping is testable. gatherOne lived under a v8-ignore
// because it spawns git, which is exactly why this defect survived: nothing
// could observe it.
import { z } from 'zod';
import { toWorktreeState, type WorktreeState } from './estate-verify.js';

/** What ONE git invocation produced.
 *
 *  Schema-first: this crosses the boundary between the spawning shell and this
 *  pure core, and the whole point is that a caller cannot hand us a shape that
 *  conflates the two cases. */
export const GitOutcomeSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), out: z.string() }),
  z.strictObject({ ok: z.literal(false) }),
]);
export type GitOutcome = z.infer<typeof GitOutcomeSchema>;

/** The four readings one worktree needs. */
export const WorktreeReadingsSchema = z.strictObject({
  /** `git rev-parse @{u}`. Failure is EXPECTED and normal: a branch with no
   *  upstream cannot be ahead of one, which the driver observed on its first
   *  live run. This is the ONE call whose failure is not a defect. */
  upstream: GitOutcomeSchema,
  /** `git rev-list --count upstream..HEAD`, read only when an upstream exists. */
  ahead: GitOutcomeSchema,
  /** `git status --porcelain`. Empty means clean; FAILED means unknown. */
  status: GitOutcomeSchema,
  /** `git stash list`. Empty means none; FAILED means unknown. */
  stash: GitOutcomeSchema,
});
export type WorktreeReadings = z.infer<typeof WorktreeReadingsSchema>;

/** What one worktree yielded. Three outcomes, not two: a git command that could
 *  not run is neither a state nor a schema rejection, and reporting it as
 *  either would misname the remedy. */
export type GatheredOne =
  | { readonly kind: 'state'; readonly state: WorktreeState }
  | { readonly kind: 'git-failed' }
  | { readonly kind: 'rejected' };

const NL = String.fromCharCode(10);

/** Lines in command output. Only ever called on output that RAN. */
function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split(NL).length;
}

/** One worktree's readings, resolved into a state or a named failure.
 *
 *  Every required reading must have RUN. Previously a failure here produced a
 *  zero and the zero was reported as cleanliness; now it produces git-failed,
 *  which the decider turns into exit 3 and REPAIR_TOOLING. */
export function gatherOneFrom(
  rec: { readonly path: string; readonly branch: string;
         readonly prunable: boolean; readonly locked: boolean },
  readings: WorktreeReadings,
): GatheredOne {
  // status and stash are REQUIRED. Empty output from them is meaningful; a
  // failure is not, and must never be read as a zero.
  if (!readings.status.ok || !readings.stash.ok) return { kind: 'git-failed' };

  // NO UPSTREAM is a normal state, not a failure: nothing to be ahead of.
  const hasUpstream = readings.upstream.ok && readings.upstream.out.length > 0;

  // But if there IS an upstream, counting against it must succeed. A failed
  // count previously became 0 -- "no unpushed commits" -- which is the same
  // confident zero wearing a different hat.
  if (hasUpstream && !readings.ahead.ok) return { kind: 'git-failed' };

  const ahead = hasUpstream && readings.ahead.ok
    ? Number(readings.ahead.out.length > 0 ? readings.ahead.out : '0')
    : 0;
  // git prints a decimal count; anything else means the format moved under us.
  if (!Number.isFinite(ahead) || !Number.isInteger(ahead) || ahead < 0) {
    return { kind: 'git-failed' };
  }

  const state = toWorktreeState({
    path: rec.path,
    branch: rec.branch,
    dirtyFileCount: countLines(readings.status.out),
    aheadOfRemote: ahead,
    stashCount: countLines(readings.stash.out),
    prunable: rec.prunable,
    locked: rec.locked,
  });
  return state === null ? { kind: 'rejected' } : { kind: 'state', state };
}
