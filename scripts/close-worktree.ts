// scripts/close-worktree.ts
// GREEN (worktree-close arc, 2026-07-15): pure decision core for closing a
// git worktree. Captured as a root script because sync-worktrees.ts has no
// removal path and hand-rolled git idioms are not rediscoverable.
// Purity: no child_process, no fs, no git. Callers gather state and pass it
// in; this module only decides and emits argv. Mirrors the sync-worktrees.ts
// precedent: refuse on any loss risk, never force, never reset.

import { z } from 'zod';

export const WorktreeCloseInputSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  hasUpstream: z.boolean(),
  aheadOfRemote: z.number().int().min(0),
  dirtyFileCount: z.number().int().min(0),
  containedInIntegration: z.boolean(),
  isPrimaryClone: z.boolean(),
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
  | { action: 'refuse'; reasons: CloseRefusalReason[] };

export function decideClose(raw: WorktreeCloseInput): CloseVerdict {
  const input = WorktreeCloseInputSchema.parse(raw);
  if (input.isPrimaryClone === true) {
    return { action: 'refuse', reasons: ['primary-clone'] };
  }
  const reasons: CloseRefusalReason[] = [];
  if (input.hasUpstream === false) reasons.push('no-upstream');
  if (input.aheadOfRemote > 0) reasons.push('unpushed');
  if (input.dirtyFileCount > 0) reasons.push('dirty');
  if (input.containedInIntegration === false) reasons.push('unmerged');
  if (reasons.length > 0) return { action: 'refuse', reasons };
  return { action: 'remove', reasons: [] };
}

export function closePlan(verdict: CloseVerdict, input: WorktreeCloseInput): string[][] {
  if (verdict.action === 'refuse') return [];
  return [
    ['git', 'worktree', 'remove', input.path],
    ['git', 'branch', '-d', input.branch],
  ];
}
