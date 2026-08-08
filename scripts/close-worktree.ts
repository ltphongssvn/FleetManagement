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
// remove-keep-branch, whose plan omits git branch -d entirely: the branch is
// preserved on purpose (it survives on origin as history), so the local ref
// must not be deleted. Omitting the command is stronger than trusting -d to
// refuse on containment.
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
  if (input.aheadOfRemote > 0) reasons.push('unpushed');
  if (input.dirtyFileCount > 0) reasons.push('dirty');
  // recent is a loss-risk guard: active work is active even for a retired close,
  // so it is NOT waived by retired (unlike unmerged below). Strict < so exactly
  // at the threshold counts as stale (removable).
  if (input.idleHours < RECENT_IDLE_THRESHOLD_HOURS) reasons.push('recent');
  // retired waives ONLY this one: the branch is intentionally not merged.
  // Written in the ! idiom the root-scripts lint (#400) enforces.
  if (!input.containedInIntegration && !input.retired) reasons.push('unmerged');
  if (reasons.length > 0) return { action: 'refuse', reasons };
  if (input.retired) return { action: 'remove-keep-branch', reasons: [] };
  return { action: 'remove', reasons: [] };
}

export function closePlan(verdict: CloseVerdict, input: WorktreeCloseInput): string[][] {
  if (verdict.action === 'refuse') return [];
  const plan: string[][] = [['git', 'worktree', 'remove', input.path]];
  // remove-keep-branch deliberately stops here: the retired branch ref stays.
  if (verdict.action === 'remove') {
    plan.push(['git', 'branch', '-d', input.branch]);
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
export function makeCloseInput(
  overrides: Partial<WorktreeCloseInput> = {},
): WorktreeCloseInput {
  return WorktreeCloseInputSchema.parse({
    path: '/home/u/code/wt-fixture',
    branch: 'feature/fixture',
    hasUpstream: true,
    aheadOfRemote: 0,
    dirtyFileCount: 0,
    containedInIntegration: true,
    isPrimaryClone: false,
    retired: false,
    idleHours: 999,
    ...overrides,
  });
}
