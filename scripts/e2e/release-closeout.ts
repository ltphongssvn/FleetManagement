// scripts/e2e/release-closeout.ts
// GitFlow release closeout. SSOT = releaseCloseoutConfigSchema. The back-merge
// subject is derived from semantic-release's ACTUAL decision (read via
// `pnpm release:dry`), never from `git tag` guesswork — fixing the bug where the
// subject referenced a stale/whole-list tag on a chore-only (no-release) merge.
// Pure parser + subject builder are unit-tested; side-effecting main() runs only
// as entrypoint.
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

// Parse semantic-release output. PUBLISHED -> "Published release X.Y.Z" or
// "next release version is X.Y.Z" (dry-run). NO RELEASE -> "no relevant changes,
// so no new version is released". Anything ambiguous fails safe to not-released
// so a version is never fabricated.
export function parseReleaseDecision(log: string): ReleaseDecision {
  if (/no relevant changes, so no new version is released/i.test(log)) {
    return { released: false, version: null };
  }
  const m =
    /(?:Published release|next release version(?: is)?|The next release version is|Release version)\s+v?(\d+\.\d+\.\d+)/i.exec(log);
  if (m?.[1] !== undefined) return { released: true, version: m[1] };
  return { released: false, version: null };
}

export function backMergeSubject(d: ReleaseDecision, prNumber: number): string {
  if (d.released && d.version !== null) {
    return `Merge main into develop: back-merge #${String(prNumber)} (release v${d.version} published)`;
  }
  return `Merge main into develop: back-merge #${String(prNumber)} (chore-only, no release published)`;
}

// ---- side-effecting (entrypoint only) ----
function run(cmd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`❌ ${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return `${r.stdout}${r.stderr}`;
}

function main(): void {
  const prArg = process.argv[2];
  if (prArg === undefined || !/^\d+$/.test(prArg)) {
    console.error('usage: tsx scripts/e2e/release-closeout.ts <prNumber>');
    process.exit(1);
  }
  const cfg = releaseCloseoutConfigSchema.parse({ prNumber: Number(prArg) });

  console.log('📡 fetching + reading semantic-release decision (release:dry) ...');
  run('git', ['fetch', 'origin', '--prune', '--tags', '--quiet'], { allowFail: true });
  // Dry-run on the up-to-date base branch tells us the real decision without publishing.
  const dryLog = run('pnpm', ['run', 'release:dry'], { allowFail: true });
  const decision = parseReleaseDecision(dryLog);
  console.log(decision.released ? `✅ release decision: v${decision.version ?? '?'} published` : 'ℹ️  release decision: no release (chore-only)');

  const subject = backMergeSubject(decision, cfg.prNumber);
  console.log(`🔁 back-merge subject: ${subject}`);

  run('git', ['checkout', cfg.developBranch]);
  run('git', ['pull', '--ff-only'], { allowFail: true });
  const mergeOut = run('git', ['merge', `origin/${cfg.baseBranch}`, '--no-ff', '-m', subject], { allowFail: true });
  if (/Already up to date/i.test(mergeOut)) {
    console.log('✅ develop already contains main — nothing to back-merge.');
    return;
  }
  run('git', ['push', 'origin', cfg.developBranch]);

  run('git', ['fetch', 'origin', '--prune', '--quiet'], { allowFail: true });
  const delta = run('git', ['rev-list', '--left-right', '--count', `origin/${cfg.baseBranch}...origin/${cfg.developBranch}`]).trim();
  console.log(`✅ reconciled — main<->develop delta (left=main ahead, right=develop ahead): ${delta}`);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) { main(); }
