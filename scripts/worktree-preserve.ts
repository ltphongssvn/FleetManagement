// scripts/worktree-preserve.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): pure decision cores for
// //#worktree:preserve. No child_process, no fs, no git. Callers gather state
// and pass it in; this module only decides -- the same core/shell split
// close-worktree.ts and deps-reconcile.ts use.
//
// WHY THIS EXISTS. A census found four worktrees pinned to the yanked pnpm
// 11.13.0 and frozen since 2026-07-11. Three held UNCOMMITTED work, none had
// ever had a PR, and each carried a new source file with its test -- an
// abandoned RED-GREEN slice. worktree:close correctly REFUSED all three on
// dirty, but a refusal is not a resolution: the work sat one mistaken --force
// from deletion for twenty-five days while the operator saw only a TOOLCHAIN
// warning suggesting a version bump.
//
// WHY NOT git stash, learned the hard way in that same session. Stash is LOCAL
// -- stashes are never transferred to the remote -- so a stashed rescue dies
// with the machine, and 2026 guidance puts stash's useful threshold in hours,
// recommending a WIP commit on a branch for anything longer precisely because
// it can be pushed. Worse, the failure was SILENT: git stash create captured
// only tracked changes, encoding untracked files onto a third parent that
// git show --stat does not traverse. The snapshot reported success while
// omitting the new source files that were the entire substance of two slices.
// Had that been trusted, closing the worktrees would have destroyed exactly
// the work the snapshot was taken to protect.
//
// HENCE THE COUNT GATE. verifyPreservation demands EQUALITY between observed
// dirty files and committed files. Not "at least" -- a surplus means the scope
// was wrong just as a shortfall means work was dropped. That gate is what
// caught the stash loss, so it is encoded as a permanent property of the tool
// rather than left as something an operator must remember to check.
import { z } from 'zod';
const NL = String.fromCharCode(10);
// ---------------------------- porcelain parsing ----------------------------
export interface DirtyEntry {
  path: string;
  staged: boolean;
  untracked: boolean;
}
// git status --porcelain=v1 --untracked-files=all. Column 1 is the INDEX
// status, column 2 the worktree status: a staged modification reads "M " and
// an unstaged one " M". Both are losable, so both count -- but the
// distinction is preserved because it is exactly what stash treated
// differently, and a future reader deserves to see that it was considered.
// Paths are taken from index 3 to end WITHOUT splitting on whitespace: real
// paths here contain parentheses and could contain spaces.
export function parseDirtyEntries(stdout: string): DirtyEntry[] {
  return stdout
    .split(NL)
    .filter((line) => line.length > 3)
    .map((line) => {
      const index = line.charAt(0);
      const tree = line.charAt(1);
      return {
        path: line.slice(3),
        staged: index !== ' ' && index !== '?',
        untracked: index === '?' && tree === '?',
      };
    });
}
// ---------------------------- classification -------------------------------
export interface PreservationInput {
  path: string;
  branch: string | null;
  entries: readonly DirtyEntry[];
}
export type PreservationPlan =
  | { action: 'skip'; reason: 'clean' }
  | { action: 'refuse'; reason: 'detached' }
  | { action: 'preserve'; fileCount: number };
// A detached worktree is REFUSED rather than preserved: a commit made on a
// detached HEAD is reachable by no ref, so "preserving" there would produce
// exactly the silent loss this tool exists to prevent.
export function classifyPreservation(input: PreservationInput): PreservationPlan {
  if (input.entries.length === 0) return { action: 'skip', reason: 'clean' };
  if (input.branch === null) return { action: 'refuse', reason: 'detached' };
  return { action: 'preserve', fileCount: input.entries.length };
}
// ---------------------------- the load-bearing gate ------------------------
export const PreservationCountSchema = z.object({
  expected: z.number().int().min(0),
  committed: z.number().int().min(0),
});
export type PreservationCount = z.infer<typeof PreservationCountSchema>;
export type PreservationVerdict =
  | { kind: 'verified' }
  | { kind: 'shortfall'; missing: number }
  | { kind: 'surplus'; extra: number };
// EQUALITY, deliberately. A shortfall means files were dropped; a surplus
// means the commit swept in something outside the observed scope. Either way
// the operation did not do what it reported, and reporting success would be
// the confident zero this repo refuses everywhere else.
export function verifyPreservation(count: PreservationCount): PreservationVerdict {
  const c = PreservationCountSchema.parse(count);
  if (c.committed < c.expected) return { kind: 'shortfall', missing: c.expected - c.committed };
  if (c.committed > c.expected) return { kind: 'surplus', extra: c.committed - c.expected };
  return { kind: 'verified' };
}
// ---------------------------- commit message -------------------------------
export interface CommitMessageInput {
  branch: string;
  fileCount: number;
}
// The message must defend itself against a future reader who finds a WIP
// commit on a branch and wonders whether it was meant to ship.
export function commitMessageFor(input: CommitMessageInput): string {
  return (
    'wip: preserve ' + String(input.fileCount) + ' uncommitted file(s) on ' + input.branch + NL + NL +
    'Preservation commit -- NOT an integration candidate.' + NL + NL +
    'This worktree held uncommitted work that worktree:close correctly refused' + NL +
    'to discard. Committing it to its own unmerged branch makes it pushable and' + NL +
    'verifiable by file count, which git stash is not: stashes never reach the' + NL +
    'remote, and a stash of untracked files can report success while silently' + NL +
    'omitting them.'
  );
}
// ---------------------------- consent --------------------------------------
export interface PreserveOptions {
  execute: boolean;
}
// Dry-run by default, matching deps:reconcile, repair:* and intake:redrive.
export function resolvePreserveExecute(options: PreserveOptions): boolean {
  return options.execute;
}
// ---------------------------- exit vocabulary ------------------------------
// 2 stays RESERVED for usage per universal CLI convention. SHORTFALL dominates
// every other outcome because it is the only one that means work may already
// be gone -- a refusal is a safe stop, a shortfall is a possible loss.
export const PRESERVE_EXIT = {
  ok: 0,
  refused: 1,
  usage: 2,
  shortfall: 3,
} as const;
export interface PreserveSummary {
  preserved: number;
  refused: number;
  shortfall: number;
  skipped: number;
}
export function preserveExitCode(s: PreserveSummary): number {
  if (s.shortfall > 0) return PRESERVE_EXIT.shortfall;
  if (s.refused > 0) return PRESERVE_EXIT.refused;
  return PRESERVE_EXIT.ok;
}
