// scripts/close-worktree.ts
// GREEN (worktree-close arc, 2026-07-15): pure decision core for closing a
// git worktree. Captured as a root script because sync-worktrees.ts has no
// removal path and hand-rolled git idioms are not rediscoverable.
// Purity: no child_process, no fs, no git. Callers gather state and pass it
// in; this module only decides and emits argv. Mirrors the sync-worktrees.ts
// precedent: refuse on any loss risk, never force, never reset.
//
// RETIRED branches (F4, 2026-07-22): a branch can be deliberately retired --
// pushed, clean, upstream-tracked, but never merged and never intended to be.
// Its worktree could previously never be closed, because containedInIntegration
// = false is a flat unmerged refusal, so the directory parked on disk forever
// (observed: t4-wt6-co-so-du-lieu). retired is an explicit opt-in flag that
// waives ONLY the unmerged reason. Every loss-risk guard (primary-clone,
// no-upstream, unpushed, dirty) still refuses, because retiring a branch does
// not make losing work acceptable. A retired close yields its own verdict,
// remove-keep-branch, whose plan omits the branch delete entirely: the branch is
// preserved on purpose (it survives on origin as history), so the local ref
// must not be deleted.
//
// RECENCY guard (2026-07-28): a worktree can be ancestry-contained, PR-merged,
// clean, and have no open PR -- yet still be the LIVE working directory a
// terminal is actively coding in, in the gap between one slice merging and the
// next being pushed (near-miss: t20-wt1-twelve-factor-audit, ahead=0, PR #440
// merged, but its per-worktree HEAD reflog showed activity 1h prior). The
// driver computes idleHours from git reflog --date=unix -1 (the 2026 liveness
// primitive -- real git activity, immune to the fs-mtime noise of pnpm install /
// editor autosave / build artifacts). recent is a LOSS-RISK guard: it refuses
// even a retired close, because active work is active regardless of merge intent.
// FAIL-SAFE DEFAULT (Saltzer-Schroeder / arc42 interlock): the hazard is
// deleting live work, so idleHours defaults to 0 (recent) -- a caller that omits
// the signal fails safe by refusing, never fails open by deleting.
//
// ONE ROOT CLASS, THREE INSTANCES (2026-08-09). aheadOfRemote is measured
// against the BRANCH'S OWN upstream, which goes stale the moment a PR merges and
// the branch is later synced down from develop. Asking how a branch compares to
// its own ref answers the wrong question; the one that matters is whether the
// work is in the INTEGRATION branch:
//   sync:worktrees  -- reported "ahead 117; nothing to pull" on a merged branch
//   worktree:close  -- refused "unpushed" while contained=true (fixed below)
//   git branch -d   -- refuses unless merged to HEAD *or its upstream* (fixed
//                      below by not delegating the question to it at all)
//
// UNPUSHED MEANS WORK COULD BE LOST. The predicate was `aheadOfRemote > 0`
// alone, so closing t1-wt2-cf-beacon-no-transform refused with ahead=117
// contained=true idleH=604 -- 117 commits already in origin/develop, nothing to
// lose, 25 days idle, and yet uncloseable. Six sibling worktrees sat the same
// way. Loss now requires BOTH conditions.
//
// THE PLAN DELETES WITH -D, AND THAT IS THE SAFER OPTION HERE. The live run
// proved -d cannot do this job: it failed with "not fully merged" while git
// itself printed "even though it is merged to HEAD", because the branch's own
// remote ref was stale. That crash left the worktree REMOVED and the branch ref
// alive -- a partially applied plan, strictly worse than refusing. decideClose
// has already proved ancestry against origin/develop, a stronger and correctly
// referenced check than -d performs, and the `remove` verdict is issued ONLY
// when containedInIntegration is true (a retired close yields remove-keep-branch
// and emits no delete at all). So -D under a remove verdict cannot lose work.
// The invariant that replaces "never force": a branch delete NEVER appears in a
// plan the core did not clear. `git worktree remove` keeps no force flag --
// discarding an unclean tree was never cleared by the core.

import { z } from 'zod';

// Hours since the last per-worktree HEAD reflog entry below which a worktree is
// treated as actively developed and protected. 24h is the 2026 convention; a
// named constant so it is tunable and rediscoverable.
export const RECENT_IDLE_THRESHOLD_HOURS = 24;

export const WorktreeCloseInputSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  hasUpstream: z.boolean(),
  aheadOfRemote: z.number().int().min(0),
  dirtyFileCount: z.number().int().min(0),
  containedInIntegration: z.boolean(),
  isPrimaryClone: z.boolean(),
  retired: z.boolean().default(false),
  // DONE (2026-08-11): explicit operator declaration that the session on this
  // worktree is finished. Waives ONLY the recency guard, and only when the
  // work is contained in the integration branch. Defaults false, so every
  // existing caller is unchanged and the guard stays on by default.
  done: z.boolean().default(false),
  // Fail-safe default 0 (recent -> protected): missing liveness data must never
  // permit a delete. Drivers always supply the real reflog-derived value.
  idleHours: z.number().min(0).default(0),
});

export type WorktreeCloseInput = z.infer<typeof WorktreeCloseInputSchema>;

export const CLOSE_REFUSAL_REASONS = [
  'primary-clone',
  'no-upstream',
  'unpushed',
  'dirty',
  'recent',
  'unmerged',
] as const;

export type CloseRefusalReason = (typeof CLOSE_REFUSAL_REASONS)[number];

export type CloseVerdict =
  | { action: 'remove'; reasons: [] }
  | { action: 'remove-keep-branch'; reasons: [] }
  | { action: 'refuse'; reasons: CloseRefusalReason[] };

export function decideClose(raw: WorktreeCloseInput): CloseVerdict {
  const input = WorktreeCloseInputSchema.parse(raw);
  if (input.isPrimaryClone) {
    return { action: 'refuse', reasons: ['primary-clone'] };
  }
  const reasons: CloseRefusalReason[] = [];
  if (!input.hasUpstream) reasons.push('no-upstream');
  // Loss requires BOTH: commits the branch's own remote lacks, AND those commits
  // not being in the integration branch either. Containment is what makes the
  // remote-distance harmless. Deliberately NOT waived by retired: a retired
  // branch with uncontained local-only commits still has work to lose.
  if (input.aheadOfRemote > 0 && !input.containedInIntegration) reasons.push('unpushed');
  if (input.dirtyFileCount > 0) reasons.push('dirty');
  // recent is a loss-risk guard: active work is active even for a retired close,
  // so it is NOT waived by retired (unlike unmerged below). Strict < so exactly
  // at the threshold counts as stale (removable).
  //
  // done + contained waives it, and ONLY that combination. idleHours is a
  // PROXY for work-may-be-in-flight; containment is DIRECT EVIDENCE the work
  // is finished and pushed. A proxy must not outrank direct evidence -- but
  // containment alone cannot waive it either, because the t20 near-miss this
  // guard was built for was ALSO contained. So the operator supplies the one
  // fact neither git nor a clock can know -- that the session is over -- and
  // the machine still requires its own evidence before honouring it.
  // Invoking the flag IS the operator deciding (deps:reconcile doctrine).
  // Observed cost of not having this: t106-wt1-driver-delete-audit finished
  // with every PR merged and production verified, and was uncloseable purely
  // because the operator was still at the keyboard.
  const recencyWaived = input.done && input.containedInIntegration;
  if (input.idleHours < RECENT_IDLE_THRESHOLD_HOURS && !recencyWaived) reasons.push('recent');
  // retired waives ONLY this one: the branch is intentionally not merged.
  // Written in the ! idiom the root-scripts lint (#400) enforces.
  if (!input.containedInIntegration && !input.retired) reasons.push('unmerged');
  if (reasons.length > 0) return { action: 'refuse', reasons };
  if (input.retired) return { action: 'remove-keep-branch', reasons: [] };
  return { action: 'remove', reasons: [] };
}

export function closePlan(verdict: CloseVerdict, input: WorktreeCloseInput): string[][] {
  if (verdict.action === 'refuse') return [];
  // No --force: discarding an unclean working tree was never cleared by the core.
  const plan: string[][] = [['git', 'worktree', 'remove', input.path]];
  // remove-keep-branch deliberately stops here: the retired branch ref stays.
  if (verdict.action === 'remove') {
    // -D, not -d: see the header. The core proved containment against the
    // integration branch; -d re-asks that question against the branch's own
    // upstream and refuses on a stale ref, which crashed the plan mid-flight.
    plan.push(['git', 'branch', '-D', input.branch]);
  }
  return plan;
}

// Test-fixture factory (2026 builder pattern, co-located with the schema so a
// new field is defaulted in ONE place, never a shotgun edit across test files).
// Default state is a STALE, clean, pushed, merged, non-primary worktree -- i.e.
// the removable baseline -- so each test overrides ONLY the dimension it
// exercises. idleHours defaults to 999 (well past RECENT_IDLE_THRESHOLD_HOURS)
// so recency never masks an unrelated assertion; a recency test overrides it.
// Returns a parsed WorktreeCloseInput so fixtures cannot drift from the schema.
export function makeCloseInput(overrides: Partial<WorktreeCloseInput> = {}): WorktreeCloseInput {
  return WorktreeCloseInputSchema.parse({
    path: '/home/u/code/wt-fixture',
    branch: 'feature/fixture',
    hasUpstream: true,
    aheadOfRemote: 0,
    dirtyFileCount: 0,
    containedInIntegration: true,
    isPrimaryClone: false,
    retired: false,
    done: false,
    idleHours: 999,
    ...overrides,
  });
}
