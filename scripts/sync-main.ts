// scripts/sync-main.ts
// Worktree-safe `main` fast-forward + programmatic divergence assertion.
//
// Why this shape (each choice traces to reproduced CLI evidence, not theory):
//  - NO `git switch`/`git checkout main`: in this worktree-per-branch repo, main
//    is bound to a sibling worktree, so switching to it fails atomically
//    (`fatal: 'main' is already used by worktree ...`). We update main BY PATH
//    via `git -C <mainWorktree>` and never switch branches.
//  - Divergence is asserted STANDALONE, BEFORE any merge, as a three-way verdict
//    (synced / behind-fast-forwardable / truly-diverged). An assertion placed
//    AFTER `pull --ff-only` is dead code: a successful ff makes local == remote,
//    and a real divergence makes `--ff-only` exit non-zero first.
//  - stderr is surfaced on failure (git prints branch-context to stderr); it is
//    not masked.
import { spawnSync } from 'node:child_process';

const git = (args: string[], cwd?: string): string => {
  const r = spawnSync('git', args, { encoding: 'utf-8', cwd });
  if (r.status !== 0) {
    console.error(`❌ git ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout.trim();
};
const short = (h: string): string => h.slice(0, 7);

function resolveMainWorktree(): string {
  const porcelain = git(['worktree', 'list', '--porcelain']);
  let current = '';
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = line.slice('worktree '.length);
    } else if (line === 'branch refs/heads/main' && current !== '') {
      return current;
    }
  }
  console.error('❌ No worktree has `main` checked out.');
  process.exit(1);
}

function syncMain(): void {
  const wt = resolveMainWorktree();
  console.log(`🔄 main worktree: ${wt}`);
  git(['fetch', 'origin', 'main', '--quiet'], wt);

  const local = git(['rev-parse', 'main'], wt);
  const remote = git(['rev-parse', 'origin/main'], wt);

  if (local === remote) {
    console.log(`✅ already synced @ ${short(local)} — nothing to do.`);
    return;
  }
  const behind =
    spawnSync('git', ['-C', wt, 'merge-base', '--is-ancestor', 'main', 'origin/main']).status === 0;
  if (!behind) {
    console.error(
      `❌ main has DIVERGED (local commits not on origin) — manual reconcile required.`,
    );
    process.exit(1);
  }
  const n = git(['rev-list', '--count', 'main..origin/main'], wt);
  console.log(
    `⏩ main is BEHIND by ${n} — fast-forwarding ${short(local)} → ${short(remote)} (by path).`,
  );
  git(['merge', '--ff-only', 'origin/main'], wt);

  const after = git(['rev-parse', 'main'], wt);
  if (after !== remote) {
    console.error('❌ post-merge mismatch — main did not reach origin/main.');
    process.exit(1);
  }
  console.log(`✅ SYNCED main @ ${short(after)}.`);
}

syncMain();
