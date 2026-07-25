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

import { z } from 'zod';

export const WorktreeCloseInputSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  hasUpstream: z.boolean(),
  aheadOfRemote: z.number().int().min(0),
  dirtyFileCount: z.number().int().min(0),
  containedInIntegration: z.boolean(),
  isPrimaryClone: z.boolean(),
  retired: z.boolean().default(false),
});

export type WorktreeCloseInput = z.infer<typeof WorktreeCloseInputSchema>;

export const CLOSE_REFUSAL_REASONS = [
  'primary-clone',
  'no-upstream',
  'unpushed',
  'dirty',
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
