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

// Parse semantic-release output into a release decision. Strips the tool banner
// ("Running semantic-release version X") so it is never mistaken for a release.
export function parseReleaseDecision(log: string): ReleaseDecision {
  const meaningful = log
    .split('\n')
    .filter((ln) => !/running semantic-release version/i.test(ln))
    .join('\n');
  const noRelease =
    /no relevant changes, so no new version is released/i.test(meaningful) ||
    /a new version won['\u2019]t be published/i.test(meaningful) ||
    /will not be published/i.test(meaningful);
  if (noRelease) return { released: false, version: null };
  const m =
    /(?:Published release|The next release version is|next release version is|Created tag)\s+v?(\d+\.\d+\.\d+)/i.exec(
      meaningful,
    );
  if (m?.[1] !== undefined) return { released: true, version: m[1] };
  return { released: false, version: null };
}

// A verdict is trustworthy only if semantic-release ran on the publish branch.
export function releaseDecisionIsAuthoritative(log: string, publishBranch: string): boolean {
  if (/a new version won['\u2019]t be published/i.test(log)) return false;
  if (/configured to only publish from/i.test(log)) return false;
  const onBranch = new RegExp('on (?:the )?branch ' + publishBranch + '\\b', 'i').test(log);
  return (
    onBranch ||
    /no relevant changes, so no new version is released/i.test(log) ||
    /Published release|The next release version is/i.test(log)
  );
}

export function backMergeSubject(d: ReleaseDecision, prNumber: number): string {
  if (d.released && d.version !== null) {
    return 'Merge main into develop: back-merge #' + String(prNumber) + ' (release v' + d.version + ' published)';
  }
  return 'Merge main into develop: back-merge #' + String(prNumber) + ' (chore-only, no release published)';
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
  const dryLog = run('pnpm', ['--dir', mainWt, 'run', 'release:dry'], { allowFail: true });
  if (!releaseDecisionIsAuthoritative(dryLog, cfg.baseBranch)) {
    console.error('\u274c release decision not authoritative (dry-run did not run on ' + cfg.baseBranch + '). Refusing to write a back-merge subject.');
    process.exit(1);
  }
  const decision = parseReleaseDecision(dryLog);
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
