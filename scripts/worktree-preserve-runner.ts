// scripts/worktree-preserve-runner.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): the preservation sweep, with
// its git writes INJECTED so the loop is testable by execution.
//
// WHY INJECTION. A source-contract guard can only assert that a file mentions
// the right identifiers; it cannot prove a dry run wrote nothing, that a
// detached worktree was never committed to, that a push was withheld when the
// count gate failed, or that a throwing git command did not abort the sweep.
// With the port as a parameter each of those is an assertion about a recorded
// call log -- the difference between approximating behaviour and demonstrating
// it.
//
// ORDER IS THE SAFETY PROPERTY: stage -> commit -> COUNT -> push. The gate sits
// before the push deliberately. Publishing an incomplete preservation would
// make a partial rescue look durable, which is strictly worse than a local
// failure the operator can still see and repair. git stash create already
// demonstrated that failure mode -- it reported success while dropping
// untracked files, 1 of 3 and then 2 of 4 -- and had those been pushed under a
// wip/ tag, the loss would have been invisible and believed safe.
//
// OPERATIONAL FAILURES ARE ISOLATED, NOT FATAL. An earlier version let an
// execFileSync throw escape the loop, so a git error on worktree 7 of 44 would
// abort the sweep -- possibly after committing to six worktrees and pushing
// none. That is precisely the partial state the count gate exists to prevent,
// reintroduced one level up. The 2026 Node practice is to distinguish
// OPERATIONAL errors, handled at runtime, from programmer errors, and to fail
// fast but fail SAFELY: an unreliable external boundary must not crash the
// whole run. Each target is therefore wrapped, records its own outcome, and
// the sweep continues.
//
// FAILED IS NOT SHORTFALL, and the distinction is where the WORK is. A
// shortfall means files may be GONE. A failure means git errored and the work
// is still sitting uncommitted -- unresolved but intact. A push failure in
// particular is only a publishing failure: the commit landed, so calling it a
// shortfall would overstate the risk and send the operator hunting for lost
// files that are not lost.
import {
  classifyPreservation,
  commitMessageFor,
  preserveExitCode,
  verifyPreservation,
  type DirtyEntry,
  type PreserveSummary,
} from './worktree-preserve.js';
const NL = String.fromCharCode(10);
// The seam. Production passes a git wrapper; tests pass a recorder, so
// "dry-run writes nothing" is asserted as an EMPTY call list.
export interface WorktreeWritePort {
  stageAll(path: string): void;
  commit(path: string, message: string): void;
  countCommittedFiles(path: string): number;
  pushBranch(path: string, branch: string): void;
}
export interface PreserveTarget {
  path: string;
  branch: string | null;
  entries: readonly DirtyEntry[];
}
export interface PreserveRunOptions {
  execute: boolean;
}
export interface PreserveReport {
  planned: number;
  summary: PreserveSummary;
  exitCode: number;
  lines: readonly string[];
}
function firstLine(text: string): string {
  return text.split(NL)[0] ?? text;
}
function reasonFrom(err: unknown): string {
  return err instanceof Error ? firstLine(err.message) : String(err);
}
export function runPreserve(
  targets: readonly PreserveTarget[],
  port: WorktreeWritePort,
  options: PreserveRunOptions,
): PreserveReport {
  const summary: PreserveSummary = {
    preserved: 0,
    refused: 0,
    failed: 0,
    shortfall: 0,
    skipped: 0,
  };
  const lines: string[] = [];
  let planned = 0;
  for (const target of targets) {
    const plan = classifyPreservation({
      path: target.path,
      branch: target.branch,
      entries: target.entries,
    });
    if (plan.action === 'skip') {
      summary.skipped += 1;
      lines.push('skip       ' + target.path + ' (' + plan.reason + ')');
      continue;
    }
    if (plan.action === 'refuse') {
      summary.refused += 1;
      lines.push(
        'REFUSE     ' + target.path + ' (' + plan.reason + ' -- no branch to commit onto)',
      );
      continue;
    }
    planned += 1;
    // DRY RUN IS UNREACHABLE-BY-CONSTRUCTION, not merely intended: the port is
    // never called on this path, so a survey cannot write.
    if (!options.execute) {
      lines.push(
        'would-preserve ' +
          target.path +
          ' (' +
          String(plan.fileCount) +
          ' file(s) on ' +
          String(target.branch) +
          ')',
      );
      continue;
    }
    const branch = target.branch ?? '';
    // ISOLATION BOUNDARY. Everything that touches git for THIS target sits
    // inside, so an operational failure is recorded and the sweep proceeds to
    // the next worktree rather than abandoning the remaining forty-three.
    try {
      port.stageAll(target.path);
      port.commit(target.path, commitMessageFor({ branch, fileCount: plan.fileCount }));
      const committed = port.countCommittedFiles(target.path);
      const verdict = verifyPreservation({ expected: plan.fileCount, committed });
      if (verdict.kind !== 'verified') {
        // NO PUSH. The commit stays local so the operator can inspect and
        // repair it; publishing would make an incomplete rescue look complete.
        summary.shortfall += 1;
        const detail =
          verdict.kind === 'shortfall'
            ? String(verdict.missing) + ' file(s) missing'
            : String(verdict.extra) + ' unexpected extra file(s)';
        lines.push(
          'SHORTFALL  ' +
            target.path +
            ' (expected ' +
            String(plan.fileCount) +
            ', committed ' +
            String(committed) +
            ' -- ' +
            detail +
            '; NOT pushed)',
        );
        continue;
      }
      port.pushBranch(target.path, branch);
      summary.preserved += 1;
      lines.push(
        'preserved  ' + target.path + ' (' + String(plan.fileCount) + ' file(s) -> ' + branch + ')',
      );
    } catch (err) {
      summary.failed += 1;
      lines.push('FAILED     ' + target.path + ' (' + reasonFrom(err) + ')');
    }
  }
  return { planned, summary, exitCode: preserveExitCode(summary), lines };
}
