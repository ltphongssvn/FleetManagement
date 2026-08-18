// scripts/stale-worktree-gate-cli.ts
// IMPERATIVE SHELL for the stale-worktree gate. Orchestration only: the verdict
// lives in stale-worktree-gate.ts, and the CLOSEABILITY judgement is delegated
// wholesale to decideClose -- never re-derived here.
//
// WHY DELEGATE RATHER THAN RE-DERIVE. pr-follow.ts and pr-automerge.ts each
// held their own copy of the check-conclusion mapping and carried the identical
// CANCELLED bug in both; sync:worktrees, worktree:close and `git branch -d` each
// asked "how does this branch compare to its OWN ref" and were wrong three
// separate ways. A second opinion about closeability would be the same mistake
// a third time. This file gathers exactly the signals worktree-close-cli.ts
// gathers, through the same parsers, and asks decideClose.
//
// RUNS WHERE WORKTREES EXIST -- deliberately NOT a CI job. A GitHub runner does
// a fresh shallow clone and has ZERO worktrees, so a CI check for idle
// worktrees would inspect an empty set, report OK, and pass forever. That is
// the "check exists in principle and nowhere in practice" class this repo has
// already closed four times (//#lint:scripts, //#typecheck:scripts,
// //#lint:e2e, and the classifyRollup core that was wired to nothing).
//
// THE THRESHOLD IS THE SHARED CONSTANT. RECENT_IDLE_THRESHOLD_HOURS is imported
// from close-worktree.ts, not restated: worktree:close refuses to delete a LIVE
// worktree and this gate insists a STALE one be reclaimed, so the two halves of
// one invariant must move together or a worktree could be gate-flagged and
// close-refused simultaneously.
//
// Run: pnpm exec turbo run worktree:stale-gate

import { execFileSync } from 'node:child_process';
import { decideClose, RECENT_IDLE_THRESHOLD_HOURS } from './close-worktree.js';
import {
  parseWorktreePorcelain,
  parseAheadBehind,
  countDirtyFiles,
  parseReflogIdleHours,
  resolveCloseInput,
} from './worktree-close.js';
import { listWorktreesArgs, upstreamArgs, aheadBehindArgs, dirtyArgs, containmentArgs, reflogArgs }
  from './worktree-close-cli.js';
import {
  classifyStaleWorktrees,
  describeStaleWorktrees,
  exitCodeForStaleGate,
  type WorktreeObservation,
} from './stale-worktree-gate.js';

const NL = String.fromCharCode(10);
const INTEGRATION_REF = 'origin/develop';

function git(args: readonly string[], cwd?: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

// stdio pipes stderr instead of inheriting it. Without this, `git rev-parse
// @{u}` on a branch with no upstream prints "fatal: no upstream configured" to
// the terminal even though the caller catches the throw -- execFileSync has
// already passed the child's stderr straight through. Two such lines appeared
// in the first live run, making a correct gate look broken. Expected-absent
// signals are queried on purpose here (an unpublished branch has no upstream by
// definition), so their noise is not a diagnostic worth showing.
function gitAllowFail(args: readonly string[], cwd?: string): string {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function observe(): readonly WorktreeObservation[] {
  const entries = parseWorktreePorcelain(git(listWorktreesArgs()));
  const primaryPath = entries[0]?.path ?? '';
  const nowSec = Math.floor(Date.now() / 1000);

  return entries.map((entry) => {
    const upstream = gitAllowFail(upstreamArgs(), entry.path);
    const ahead = upstream.length > 0
      ? parseAheadBehind(git(aheadBehindArgs(upstream), entry.path)).ahead
      : 0;
    const idleHours = parseReflogIdleHours(gitAllowFail(reflogArgs(), entry.path), nowSec);
    const input = resolveCloseInput({
      path: entry.path,
      branch: entry.branch,
      primaryPath,
      upstream,
      ahead,
      dirtyFileCount: countDirtyFiles(gitAllowFail(dirtyArgs(), entry.path)),
      containedInIntegration:
        Number(gitAllowFail(containmentArgs(INTEGRATION_REF), entry.path)) === 0,
      retired: false,
      idleHours,
    });
    // decideClose is the AUTHORITY on closeability. `remove` means contained,
    // clean, pushed and non-primary -- the work has landed and nothing can be
    // lost. Its own recency guard also refuses inside the window, so a
    // `remove` verdict already implies the worktree is not actively developed;
    // the gate's independent idle test is the belt to that braces, and keeps
    // the pure core honest without an injected decideClose.
    return {
      path: entry.path,
      branch: entry.branch,
      idleHours,
      closeable: decideClose(input).action === 'remove',
    };
  });
}

function main(): number {
  const worktrees = observe();
  const verdict = classifyStaleWorktrees({
    worktrees,
    maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
  });

  if (verdict.kind === 'invalid-policy') {
    process.stderr.write('[worktree:stale-gate] policy invalid (' + verdict.code + ')' + NL);
    return exitCodeForStaleGate(verdict);
  }
  if (verdict.kind === 'clean') {
    process.stdout.write('[worktree:stale-gate] OK -- no merged, clean, idle worktrees ' +
      'awaiting reclamation (' + String(worktrees.length) + ' inspected).' + NL);
    return exitCodeForStaleGate(verdict);
  }

  process.stderr.write('[worktree:stale-gate] ' + describeStaleWorktrees(verdict.worktrees) + NL);
  return exitCodeForStaleGate(verdict);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { process.exit(main()); }
