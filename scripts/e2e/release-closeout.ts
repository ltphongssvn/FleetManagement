// scripts/e2e/release-closeout.ts
// GitFlow release closeout. SSOT = releaseCloseoutConfigSchema. The back-merge
// subject is derived from semantic-release's ACTUAL decision, read from the MAIN
// worktree (semantic-release publishes only from main; a dry-run on develop emits
// a branch-guard line and is NOT authoritative). Never derived from `git tag`
// guesswork — fixing the bug where the subject referenced a stale/whole-list tag,
// and the bug where the tool-version banner (v25.0.3) was mis-read as a release.
import { z } from 'zod';
import { spawnSync } from 'node:child_process';

export const releaseCloseoutConfigSchema = z.object({
  baseBranch: z.string().min(1).default('main'),
  developBranch: z.string().min(1).default('develop'),
  prNumber: z.number().int().positive(),
});
export type ReleaseCloseoutConfig = z.infer<typeof releaseCloseoutConfigSchema>;

export interface ReleaseDecision {
  readonly released: boolean;
  readonly version: string | null;
}

export function backMergeSubject(d: ReleaseDecision, prNumber: number): string {
  if (d.released && d.version !== null) {
    return 'Merge main into develop: back-merge #' + String(prNumber) + ' (release v' + d.version + ' published)';
  }
  return 'Merge main into develop: back-merge #' + String(prNumber) + ' (chore-only, no release published)';
}

// Resolve the published release from git tags — the authoritative post-publish
// source for the back-merge. The Release run tags main HEAD; a tag there that is
// NOT yet on develop is exactly what this promote carries. Idempotent: once that
// tag is on develop, nothing new is reported. Pure set logic over tag lists (no
// I/O) — main() supplies the git-tag reads. Replaces the post-publish release:dry
// oracle, which is blind here (0 new commits => "no release") and needs a GH token.
export function resolveReleaseFromTags(
  tagsAtMainHead: readonly string[],
  tagsOnDevelop: readonly string[],
): ReleaseDecision {
  const onDevelop = new Set(tagsOnDevelop);
  const semverCmp = (a: string, b: string): number => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const versions = tagsAtMainHead
    .filter((t) => !onDevelop.has(t))
    .map((t) => t.replace(/^v/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort(semverCmp);
  const top = versions[versions.length - 1];
  return top === undefined ? { released: false, version: null } : { released: true, version: top };
}

// ---- side-effecting (entrypoint only) ----
function run(cmd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (r.status !== 0 && opts.allowFail !== true) {
    console.error('\u274c ' + cmd + ' ' + args.join(' ') + ' failed:\n' + (r.stderr || r.stdout));
    process.exit(1);
  }
  return r.stdout + r.stderr;
}

function resolveWorktree(branch: string): string {
  const porcelain = run('git', ['worktree', 'list', '--porcelain']);
  let current = '';
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line === 'branch refs/heads/' + branch && current !== '') return current;
  }
  console.error('\u274c no worktree has ' + branch + ' checked out');
  process.exit(1);
}

function main(): void {
  const prArg = process.argv[2];
  if (prArg === undefined || !/^\d+$/.test(prArg)) {
    console.error('usage: tsx scripts/e2e/release-closeout.ts <prNumber>');
    process.exit(1);
  }
  const cfg = releaseCloseoutConfigSchema.parse({ prNumber: Number(prArg) });

  console.log('\ud83d\udce1 reading semantic-release decision from the MAIN worktree ...');
  run('git', ['fetch', 'origin', '--prune', '--tags', '--quiet'], { allowFail: true });
  const mainWt = resolveWorktree(cfg.baseBranch);
  // Authoritative post-publish source: the tag the Release run created at main
  // HEAD that is not yet on develop. Refs are shared across worktrees; read via
  // mainWt. No release:dry here — it is blind post-publish and needs a GH token.
  const tagsAtMainHead = run('git', ['-C', mainWt, 'tag', '--points-at', 'origin/' + cfg.baseBranch], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const tagsOnDevelop = run('git', ['-C', mainWt, 'tag', '--merged', 'origin/' + cfg.developBranch], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const decision = resolveReleaseFromTags(tagsAtMainHead, tagsOnDevelop);
  console.log(decision.released ? '\u2705 release: v' + (decision.version ?? '?') + ' published' : '\u2139\ufe0f  release: none (chore-only)');

  const subject = backMergeSubject(decision, cfg.prNumber);
  console.log('\ud83d\udd01 back-merge subject: ' + subject);

  run('git', ['checkout', cfg.developBranch]);
  run('git', ['pull', '--ff-only'], { allowFail: true });
  const mergeOut = run('git', ['merge', 'origin/' + cfg.baseBranch, '--no-ff', '-m', subject], { allowFail: true });
  if (/Already up to date/i.test(mergeOut)) {
    console.log('\u2705 develop already contains main — nothing to back-merge.');
    return;
  }
  run('git', ['push', 'origin', cfg.developBranch]);
  run('git', ['fetch', 'origin', '--prune', '--quiet'], { allowFail: true });
  const delta = run('git', ['rev-list', '--left-right', '--count', 'origin/' + cfg.baseBranch + '...origin/' + cfg.developBranch]).trim();
  console.log('\u2705 reconciled — main<->develop delta (left=main ahead, right=develop ahead): ' + delta);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { main(); }
