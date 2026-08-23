// ============================================================================
// File:     FleetManagement/scripts/sync-develop.ts
// Purpose:  Merge origin/develop DOWN into the current feature branch, the
//           2026 conflict-PREVENTION practice for irreducibly multi-day arcs:
//           sync down at every milestone so any conflict is one-milestone
//           small and fresh, and every PR is born mergeable (never DIRTY).
//
// Why this exists (root cause, 2026-07-05):
//   feature/error-presentation lived ~2 days across 5 pushes while develop
//   advanced under it (parallel-worktree arcs merging via the autonomous
//   pipeline). Nothing in the workflow ever merged origin/develop down, so
//   the PR arrived mergeStateStatus=DIRTY -- the conflict window was the
//   whole arc. Industry consensus: keep branches short-lived; where an arc
//   cannot shrink, merge mainline down on a cadence and enforce up-to-date
//   at the PR gate. This task codifies the down-sync half.
//
// Standing rule: run after EVERY milestone push and IMMEDIATELY BEFORE
//   gh pr create:   pnpm exec turbo run sync:develop
//
// Behavior:
//   - refuses on a dirty working tree (never mixes sync into WIP)
//   - no-ops on develop/main themselves (sync:worktrees owns those, FF-only)
//   - fetches origin/develop, then: already up to date -> OK; clean merge ->
//     merge commit created (push it with the next milestone); CONFLICT ->
//     exits 1 with the conflicted paths listed and the merge left in place
//     for evidence-driven manual resolution (git rerere, enabled repo-wide,
//     auto-replays any previously resolved hunk).
//
// Related files:
//   - turbo.jsonc  (//#sync:develop task)
//   - package.json (sync:develop script)
//   - scripts/sync-worktrees.ts (FF-only local-branch convergence; this task
//     is the complementary DOWN-merge for the active feature branch)
// ============================================================================
import { execFileSync } from 'node:child_process';

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function main(): number {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'develop' || branch === 'main' || branch === 'HEAD') {
    process.stdout.write(
      '[sync:develop] on ' +
        branch +
        ' -- nothing to do (sync:worktrees owns integration branches)' +
        String.fromCharCode(10),
    );
    return 0;
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty !== '') {
    process.stderr.write(
      '[sync:develop] REFUSED: working tree not clean. Commit or stash first.' +
        String.fromCharCode(10),
    );
    return 1;
  }
  git(['fetch', 'origin', 'develop']);
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...origin/develop']);
  const behind = Number(counts.split(/\s+/)[1]);
  if (behind === 0) {
    process.stdout.write(
      '[sync:develop] ' +
        branch +
        ' already contains origin/develop -- up to date.' +
        String.fromCharCode(10),
    );
    return 0;
  }
  process.stdout.write(
    '[sync:develop] ' +
      branch +
      ' is behind origin/develop by ' +
      String(behind) +
      ' commit(s) -- merging down.' +
      String.fromCharCode(10),
  );
  try {
    const out = execFileSync('git', ['merge', '--no-edit', 'origin/develop'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(out);
    process.stdout.write(
      '[sync:develop] merged clean. Include the merge commit in your next push.' +
        String.fromCharCode(10),
    );
    return 0;
  } catch {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
    process.stderr.write(
      '[sync:develop] CONFLICTS -- resolve by evidence, then git add <paths> and git commit:' +
        String.fromCharCode(10),
    );
    process.stderr.write(conflicts + String.fromCharCode(10));
    return 1;
  }
}

process.exit(main());
