// ============================================================================
// File:     FleetManagement/scripts/sync-develop-guard.ts
// Purpose:  PRE-PUSH ENFORCEMENT of the sync-down rule. Blocks a push when the
//           current feature branch is behind origin/develop, so a stale branch
//           can never reach gh pr create (which requires a prior push). This is
//           the enforcement half of the conflict-prevention system whose
//           merge half is scripts/sync-develop.ts.
//
// Why a GUARD and not an auto-merge (root cause, 2026-07-10):
//   A pre-push hook that itself ran git merge origin/develop would create a
//   merge commit AFTER git has already computed the refs in flight, so the
//   merge commit would sit local-unpushed (git docs: the hook cannot change
//   what the running push sends) -- the branch would look synced locally but
//   push stale, the exact drift we are trying to kill. Git additionally
//   aborts the push if a pre-push hook exits non-zero. So the correct,
//   non-corrupting design is a GATE: detect behind-ness and fail the push
//   with the one command to fix it. The developer runs sync:develop (which
//   creates the merge commit BEFORE the next push, so it is included) and
//   pushes again. Mirrors the repo pre-push philosophy: every other pre-push
//   hook is a pass/fail gate, never a tree mutator.
//
// Wired: .pre-commit-config.yaml (id: sync-develop-guard, stages: [pre-push]).
// Bypass for genuine infra-only pushes: git push --no-verify (use sparingly).
//
// Related files:
//   - scripts/sync-develop.ts       (the DOWN-merge this guard tells you to run)
//   - scripts/sync-worktrees.ts     (FF-only local convergence)
//   - .pre-commit-config.yaml       (pre-push wiring)
//   - turbo.jsonc                   (//#sync:develop task)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LF = String.fromCharCode(10);

export interface GuardDecision {
  readonly block: boolean;
  readonly message: string;
}

// Pure decision: given the branch name and how many commits it is behind
// origin/develop, decide whether to block the push. No I/O, fully testable.
export function evaluateGuard(branch: string, behind: number): GuardDecision {
  if (branch === 'develop' || branch === 'main' || branch === 'HEAD') {
    return {
      block: false,
      message:
        '[sync-develop-guard] on ' +
        branch +
        ' -- integration branch, not gated (sync:worktrees owns these).',
    };
  }
  if (behind <= 0) {
    return {
      block: false,
      message:
        '[sync-develop-guard] ' +
        branch +
        ' is up to date with origin/develop -- push allowed.',
    };
  }
  return {
    block: true,
    message:
      '[sync-develop-guard] BLOCKED: ' +
      branch +
      ' is behind origin/develop by ' +
      String(behind) +
      ' commit(s).' +
      LF +
      '  A stale branch must not become a PR. Sync develop down first:' +
      LF +
      '    pnpm exec turbo run sync:develop' +
      LF +
      '  then push again. (Infra-only bypass: git push --no-verify.)',
  };
}

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

export function main(): number {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  // Integration branches short-circuit before any network call.
  if (branch === 'develop' || branch === 'main' || branch === 'HEAD') {
    const d = evaluateGuard(branch, 0);
    process.stdout.write(d.message + LF);
    return 0;
  }
  // Fetch so origin/develop is current -- a stale ref would let the guard
  // pass falsely. allowFail: offline pushes should not be hard-blocked by a
  // fetch failure (the gate degrades open rather than stranding the dev).
  git(['fetch', 'origin', 'develop'], { allowFail: true });
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...origin/develop'], {
    allowFail: true,
  });
  const parts = counts.split(/\s+/);
  const behind = Number(parts[1] ?? '0');
  const decision = evaluateGuard(branch, Number.isFinite(behind) ? behind : 0);
  process[decision.block ? 'stderr' : 'stdout'].write(decision.message + LF);
  return decision.block ? 1 : 0;
}

// isEntry gate: only run main() (and process.exit) when executed directly,
// so the contract test can import evaluateGuard without triggering an exit.
const isEntry =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  process.exit(main());
}
