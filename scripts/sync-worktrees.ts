// ============================================================================
// File:     FleetManagement/scripts/sync-worktrees.ts
// Purpose:  Fast-forward every git worktree's local branch to its remote
//           tracking branch, SAFELY. Fast-forwards only when a branch is purely
//           behind (behind>0, ahead=0). REFUSES and warns on true divergence
//           (ahead>0 AND behind>0) -- never force-merges, never resets, never
//           loses local commits. Leaves ahead-only and already-synced branches
//           untouched.
//
// Why this exists:
//   The autonomous pipeline keeps the REMOTE branches converged
//   (origin/develop <-> origin/main), but git never auto-updates LOCAL branches
//   in your worktrees. So local main / WT3 develop drift behind over time. This
//   codifies the FF-only sync so you never manually chase stale worktrees, while
//   the --ff-only discipline guarantees it can never clobber unpushed work.
//
// Divergence rule (git rev-list --left-right --count HEAD...@{u} => ahead behind):
//   behind>0, ahead=0  -> FAST-FORWARD (git merge --ff-only @{u})
//   ahead>0,  behind>0 -> DIVERGED: refuse, warn, print the reconcile options.
//   ahead>0,  behind=0 -> local ahead of remote: nothing to pull, leave it.
//   0, 0               -> already in sync.
//   no upstream        -> skip (nothing to sync against).
//
// Run: pnpm exec turbo run sync:worktrees   (root-scoped //# task)
//   or: pnpm run sync:worktrees
//
// Related files:
//   - turbo.jsonc  (//#sync:worktrees task)
//   - package.json (sync:worktrees script)
//   - scripts/sync-main.ts (single-branch main sync; this generalizes to all
//     worktrees and is strictly FF-only + divergence-safe)
// ============================================================================
import { execFileSync } from 'node:child_process';

function git(args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

interface Worktree {
  path: string;
  branch: string | null;
}

function listWorktrees(): Worktree[] {
  const out = git(['worktree', 'list', '--porcelain']);
  const trees: Worktree[] = [];
  let cur: Partial<Worktree> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) trees.push({ path: cur.path, branch: cur.branch ?? null });
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'detached') {
      cur.branch = null;
    }
  }
  if (cur.path) trees.push({ path: cur.path, branch: cur.branch ?? null });
  return trees;
}

function aheadBehind(cwd: string): { ahead: number; behind: number } | null {
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd,
    allowFail: true,
  });
  if (!upstream) return null;
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...' + upstream], { cwd });
  const [aheadStr, behindStr] = counts.split(/\s+/);
  return { ahead: Number(aheadStr), behind: Number(behindStr) };
}

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

function main(): void {
  process.stdout.write(DIM + 'Fetching origin (prune)...' + RESET + '\n');
  git(['fetch', '--all', '--prune']);

  const trees = listWorktrees();
  let ff = 0;
  let diverged = 0;
  let skipped = 0;
  let synced = 0;

  for (const wt of trees) {
    const label = (wt.branch ?? '(detached)') + ' ' + DIM + '@ ' + wt.path + RESET;

    if (!wt.branch) {
      process.stdout.write(DIM + 'skip' + RESET + '   ' + label + ' (detached HEAD)\n');
      skipped++;
      continue;
    }

    const ab = aheadBehind(wt.path);
    if (ab === null) {
      process.stdout.write(DIM + 'skip' + RESET + '   ' + label + ' (no upstream)\n');
      skipped++;
      continue;
    }

    const { ahead, behind } = ab;

    if (ahead === 0 && behind === 0) {
      process.stdout.write(GREEN + 'sync' + RESET + '   ' + label + ' (up to date)\n');
      synced++;
    } else if (behind > 0 && ahead === 0) {
      git(['merge', '--ff-only', '@{u}'], { cwd: wt.path });
      process.stdout.write(
        GREEN + 'ff' + RESET + '     ' + label + ' (' + behind + ' behind -> fast-forwarded)\n',
      );
      ff++;
    } else if (ahead > 0 && behind === 0) {
      process.stdout.write(
        YELLOW + 'ahead' + RESET + '  ' + label + ' (' + ahead + ' ahead of remote; nothing to pull)\n',
      );
      skipped++;
    } else {
      diverged++;
      process.stderr.write(
        RED + 'DIVERGED' + RESET + ' ' + label + '\n' +
          '         ' + RED + ahead + ' ahead AND ' + behind + ' behind -- refusing to auto-merge.' + RESET + '\n' +
          '         Local has commits the remote lacks AND vice versa. Reconcile manually:\n' +
          '           cd ' + wt.path + '\n' +
          '           git log --oneline --graph HEAD...@{u}   # inspect both sides first\n' +
          '           git rebase @{u}      # replay your commits on top (linear), OR\n' +
          '           git merge  @{u}      # create a merge commit (preserves both)\n',
      );
    }
  }

  process.stdout.write(
    '\n' + DIM + 'Summary:' + RESET + ' ' +
      GREEN + ff + ' fast-forwarded' + RESET + ', ' + GREEN + synced + ' already synced' + RESET + ', ' +
      DIM + skipped + ' skipped' + RESET + ', ' +
      (diverged > 0 ? RED : DIM) + diverged + ' diverged' + RESET + '\n',
  );

  if (diverged > 0) process.exit(1);
}

main();
