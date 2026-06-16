// scripts/e2e/release-promote.ts
// Whole GitFlow promote cycle (develop -> main) as one schema-first script,
// composing the proven pure release-closeout functions. Graduates the hand-chained
// orchestration that produced the $NEWTAG / dry-run-on-develop bugs. SSOT =
// promoteConfigSchema; pure planners (promotePhases, releaseMergeArgs) are unit-
// tested; side-effecting main() runs only as entrypoint.
import { z } from 'zod';
import { spawnSync } from 'node:child_process';

export const promoteConfigSchema = z.object({
  baseBranch: z.string().min(1).default('main'),
  developBranch: z.string().min(1).default('develop'),
  title: z.string().min(1).default('Release: develop -> main'),
});
export type PromoteConfig = z.infer<typeof promoteConfigSchema>;

export type PromotePhase = 'create_pr' | 'watch_ci' | 'admin_merge' | 'wait_release' | 'closeout';
export function promotePhases(_c: PromoteConfig): readonly PromotePhase[] {
  return ['create_pr', 'watch_ci', 'admin_merge', 'wait_release', 'closeout'];
}

// develop -> main: a MERGE commit (preserve develop boundary), --admin (branch
// protection), and NEVER --delete-branch (develop is permanent). Never --squash.
export function releaseMergeArgs(prNumber: number): readonly string[] {
  return ['pr', 'merge', String(prNumber), '--merge', '--admin'];
}

// ---- side-effecting (entrypoint only) ----
function run(cmd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0 && opts.allowFail !== true) {
    console.error('\u274c ' + cmd + ' ' + args.join(' ') + ' failed:\n' + (r.stderr || r.stdout));
    process.exit(1);
  }
  return r.stdout + r.stderr;
}

function main(): void {
  const cfg = promoteConfigSchema.parse({});
  run('git', ['fetch', 'origin', '--prune', '--tags', '--quiet'], { allowFail: true });

  const ahead = run('git', ['log', '--oneline', 'origin/' + cfg.baseBranch + '..origin/' + cfg.developBranch]).trim();
  if (ahead === '') { console.log('\u2705 ' + cfg.developBranch + ' has nothing to promote to ' + cfg.baseBranch + '.'); return; }
  console.log('\ud83d\udce6 promoting ' + cfg.developBranch + ' -> ' + cfg.baseBranch + ':\n' + ahead);

  // create_pr (reuse an existing open one if present)
  let pr = run('gh', ['pr', 'list', '--base', cfg.baseBranch, '--head', cfg.developBranch, '--state', 'open', '--json', 'number', '--jq', '.[0].number'], { allowFail: true }).trim();
  if (pr === '') {
    run('gh', ['pr', 'create', '--base', cfg.baseBranch, '--head', cfg.developBranch, '--title', cfg.title, '--body', 'Automated GitFlow promote (release:promote). See commits above.']);
    pr = run('gh', ['pr', 'list', '--base', cfg.baseBranch, '--head', cfg.developBranch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']).trim();
  }
  if (!/^\d+$/.test(pr)) { console.error('\u274c could not resolve release PR number'); process.exit(1); }
  console.log('\ud83d\udd17 release PR #' + pr);

  // watch_ci
  console.log('\u23f3 watching CI ...');
  run('gh', ['pr', 'checks', pr, '--watch'], { allowFail: true });
  const failing = run('gh', ['pr', 'checks', pr, '--json', 'bucket', '--jq', '[.[]|select(.bucket=="fail")]|length'], { allowFail: true }).trim();
  if (failing !== '0' && failing !== '') { console.error('\u274c CI not green on PR #' + pr + ' (failing=' + failing + ')'); process.exit(1); }

  // admin_merge (merge commit, no delete)
  console.log('\ud83d\udd00 admin-merge develop -> main ...');
  run('gh', releaseMergeArgs(Number(pr)));

  // wait_release (semantic-release on main push)
  console.log('\u23f3 waiting for Release workflow on ' + cfg.baseBranch + ' ...');
  const rid = run('gh', ['run', 'list', '--workflow=Release', '--branch', cfg.baseBranch, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId'], { allowFail: true }).trim();
  if (/^\d+$/.test(rid)) run('gh', ['run', 'watch', rid, '--exit-status'], { allowFail: true });

  // closeout (authoritative decision + correct back-merge subject)
  console.log('\ud83d\udd01 running release:closeout for PR #' + pr + ' ...');
  run('pnpm', ['run', 'release:closeout', pr], { allowFail: false });
  console.log('\u2705 promote complete for PR #' + pr);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { main(); }
