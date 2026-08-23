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
// args is READONLY (2026-08-08): run() only reads it, and the pure planners in
// this file return readonly arrays by design. Declaring the parameter mutable
// made releaseMergeArgs's readonly string[] unassignable here (TS2345) -- a
// conflict this signature invented by claiming a mutation right it never uses.
//
// Widening the PARAMETER is the documented fix and costs nothing: a readonly
// parameter still accepts a mutable argument, so every existing call passing an
// array literal is unaffected. Casting at the call site would have been the
// wrong direction -- passing readonly data into a mutable parameter is the
// aliasing hole that lets a callee modify values the caller believes frozen.
// spawnSync's own types demand a mutable array, so the copy happens HERE, at
// the one place that actually needs it.
function run(cmd: string, args: readonly string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0 && opts.allowFail !== true) {
    console.error('\u274c ' + cmd + ' ' + args.join(' ') + ' failed:\n' + (r.stderr || r.stdout));
    process.exit(1);
  }
  return r.stdout + r.stderr;
}

const releaseRunSchema = z.object({
  databaseId: z.number(),
  headSha: z.string(),
  status: z.string(),
  conclusion: z.string(),
});
const releaseRunArraySchema = z.array(releaseRunSchema);
export type ReleaseRun = z.infer<typeof releaseRunSchema>;

// Select the Release run for a specific merge commit (head SHA), not the most
// recent. The wait_release race that mis-tagged #94 watched --limit 1 and let
// closeout run before THIS commit's run created the tag. Matches full or short
// SHA (git rev-parse --short vs the API's 40-char headSha). Pure; main() polls.
export function selectReleaseRunForSha(
  runs: readonly ReleaseRun[],
  sha: string,
): ReleaseRun | null {
  if (sha.length < 7) return null;
  const m = runs.find(
    (r) => r.headSha === sha || r.headSha.startsWith(sha) || sha.startsWith(r.headSha),
  );
  return m ?? null;
}

function main(): void {
  const cfg = promoteConfigSchema.parse({});
  run('git', ['fetch', 'origin', '--prune', '--tags', '--quiet'], { allowFail: true });

  const ahead = run('git', [
    'log',
    '--oneline',
    'origin/' + cfg.baseBranch + '..origin/' + cfg.developBranch,
  ]).trim();
  if (ahead === '') {
    console.log(
      '\u2705 ' + cfg.developBranch + ' has nothing to promote to ' + cfg.baseBranch + '.',
    );
    return;
  }
  console.log(
    '\ud83d\udce6 promoting ' + cfg.developBranch + ' -> ' + cfg.baseBranch + ':\n' + ahead,
  );

  // create_pr (reuse an existing open one if present)
  let pr = run(
    'gh',
    [
      'pr',
      'list',
      '--base',
      cfg.baseBranch,
      '--head',
      cfg.developBranch,
      '--state',
      'open',
      '--json',
      'number',
      '--jq',
      '.[0].number',
    ],
    { allowFail: true },
  ).trim();
  if (pr === '') {
    run('gh', [
      'pr',
      'create',
      '--base',
      cfg.baseBranch,
      '--head',
      cfg.developBranch,
      '--title',
      cfg.title,
      '--body',
      'Automated GitFlow promote (release:promote). See commits above.',
    ]);
    pr = run('gh', [
      'pr',
      'list',
      '--base',
      cfg.baseBranch,
      '--head',
      cfg.developBranch,
      '--state',
      'open',
      '--json',
      'number',
      '--jq',
      '.[0].number',
    ]).trim();
  }
  if (!/^\d+$/.test(pr)) {
    console.error('\u274c could not resolve release PR number');
    process.exit(1);
  }
  console.log('\ud83d\udd17 release PR #' + pr);

  // watch_ci
  console.log('\u23f3 watching CI ...');
  run('gh', ['pr', 'checks', pr, '--watch'], { allowFail: true });
  const failing = run(
    'gh',
    ['pr', 'checks', pr, '--json', 'bucket', '--jq', '[.[]|select(.bucket=="fail")]|length'],
    { allowFail: true },
  ).trim();
  if (failing !== '0' && failing !== '') {
    console.error('\u274c CI not green on PR #' + pr + ' (failing=' + failing + ')');
    process.exit(1);
  }

  // admin_merge (merge commit, no delete)
  console.log('\ud83d\udd00 admin-merge develop -> main ...');
  run('gh', releaseMergeArgs(Number(pr)));

  // wait_release: the Release workflow runs on the main push from the admin-merge.
  // Correlate by the merge commit SHA (not most-recent) and poll until THAT run
  // exists and completes — fixes the race that mis-tagged #94 (closeout ran before
  // the run created the tag). Then fetch tags so closeout's tag oracle sees it.
  console.log('\u23f3 waiting for Release workflow on ' + cfg.baseBranch + ' ...');
  run('git', ['fetch', 'origin', '--quiet'], { allowFail: true });
  const mergeSha = run('git', ['rev-parse', 'origin/' + cfg.baseBranch]).trim();
  let chosen: ReleaseRun | null = null;
  for (let i = 0; i < 60; i += 1) {
    const raw = run(
      'gh',
      [
        'run',
        'list',
        '--workflow=Release',
        '--branch',
        cfg.baseBranch,
        '--limit',
        '20',
        '--json',
        'databaseId,headSha,status,conclusion',
      ],
      { allowFail: true },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = [];
    }
    const res = releaseRunArraySchema.safeParse(parsed);
    const runs = res.success ? res.data : [];
    const match = selectReleaseRunForSha(runs, mergeSha);
    if (match !== null && match.status === 'completed') {
      chosen = match;
      break;
    }
    if (match !== null) {
      run('gh', ['run', 'watch', String(match.databaseId), '--exit-status'], { allowFail: true });
    } else {
      run('sleep', ['10'], { allowFail: true });
    }
  }
  if (chosen === null) {
    console.error(
      '\u274c timed out waiting for Release run on ' + cfg.baseBranch + ' @ ' + mergeSha,
    );
    process.exit(1);
  }
  if (chosen.conclusion !== 'success') {
    console.error(
      '\u274c Release run ' + String(chosen.databaseId) + ' concluded: ' + chosen.conclusion,
    );
    process.exit(1);
  }
  run('git', ['fetch', 'origin', '--tags', '--quiet'], { allowFail: true });

  // closeout (authoritative decision + correct back-merge subject)
  console.log('\ud83d\udd01 running release:closeout for PR #' + pr + ' ...');
  run('pnpm', ['run', 'release:closeout', pr], { allowFail: false });
  console.log('\u2705 promote complete for PR #' + pr);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  main();
}
