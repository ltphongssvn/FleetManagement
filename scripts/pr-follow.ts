// scripts/pr-follow.ts
// Follow a merged PR all the way to a live Railway deploy, or say exactly where
// it stopped. READ-ONLY: it observes the autonomous pipeline, never drives it.
//
// Why this exists: a green PR is not shipped. The chain is
//   PR checks -> merge to develop -> develop CI + E2E -> promote.yml merges
//   develop into main -> Release (semantic-release) -> main E2E -> Deploy to
//   Railway (workflow_run on main E2E success).
// Any link can stall silently, and with hundreds of PRs a stalled link is
// invisible until someone notices production is behind. This task turns that
// into one command with a non-zero exit, so DoD is checkable instead of
// remembered.
//
// Deliberately NOT a promoter. scripts/e2e/release-promote.ts already performs a
// MANUAL develop->main promote (create PR, admin-merge, wait Release, closeout)
// as a fallback when the autonomous path is unavailable. Duplicating that here
// would race promote.yml. This tool only watches and reports.
//
// Two correlation rules the pipeline forces, both learned from real bugs:
//
//   1. Match runs by HEAD SHA, never by recency. Commit a006e8b fixed exactly
//      this ("promote waits for the Release run of THIS merge commit, not the
//      latest"), which had mis-tagged a release. runStateFor generalises
//      selectReleaseRunForSha in release-promote.ts: it tolerates a null
//      conclusion (in-flight runs) and picks the newest run when a workflow was
//      re-run for the same SHA.
//
//   2. The deploy run canNOT be matched by SHA at all. railway-deploy.yml is
//      triggered by workflow_run on main E2E, and GitHub reports such a run
//      against the DEFAULT branch head, not the main commit being deployed --
//      observed live as a deploy run labelled with the develop back-merge SHA.
//      The sanctioned correlation is therefore the first workflow_run-triggered
//      deploy created after the gating main E2E completed.
//
// A THIRD rule, added after PR #511: a CANCELLED outcome is not a FAILED one.
// This file previously collapsed both check and run conclusions with
// `conclusion === 'success' ? 'success' : 'failed'`, so a run superseded by
// `concurrency: cancel-in-progress` (correct CI configuration, and guaranteed on
// every rapid second push) was reported as a hard FAILED phase with exit 1. The
// classification now lives in check-conclusion.ts, shared with pr-automerge.ts --
// the two files previously held verbatim duplicate PASSING_CHECK_STATES sets and
// carried the identical bug in both copies. Checks are read from
// statusCheckRollup, never `gh pr checks`, whose bucketed output destroys the
// distinction before this code can see it (cli/cli#7551); a guard test enforces
// that.
import { z } from 'zod';
import { CheckRunSchema, runVerdictFor, summarizeRollup } from './check-conclusion.js';
import type { CheckRun, RollupSummary } from './check-conclusion.js';

export const DEPLOY_WORKFLOW = 'Deploy to Railway';
export const RELEASE_WORKFLOW = 'Release';
export const E2E_WORKFLOW = 'E2E (Playwright)';
export const CI_WORKFLOW = 'CI';

// ---- trust boundary (Axis 1): everything gh hands us is parsed ----

// Axis 2: the check shape is owned by check-conclusion.ts, so pr-follow.ts and
// pr-automerge.ts cannot drift apart again. Re-exported for the existing spec.
export { CheckRunSchema };
export type { CheckRun };

export const RunRecordSchema = z.object({
  databaseId: z.number().int(),
  workflowName: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  headSha: z.string(),
  createdAt: z.string(),
  event: z.string(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunListSchema = z.array(RunRecordSchema);
export const CheckListSchema = z.array(CheckRunSchema);

// ---- pure decision core ----

export type CheckSummary = RollupSummary;

export function summarizeChecks(checks: readonly CheckRun[]): CheckSummary {
  return summarizeRollup(checks);
}

// 'indeterminate' is deliberately absent: this tool OBSERVES, it does not act, so
// a superseded run maps to 'pending' -- keep watching until a run with a real
// verdict appears. Reporting 'failed' there is what produced a false exit 1.
export type RunState = 'absent' | 'pending' | 'success' | 'failed';

function shaMatches(a: string, b: string): boolean {
  if (a.length < 7 || b.length < 7) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// Shared by every run-conclusion read in this file, so the mapping cannot drift
// between the develop-gates path and the deploy path (it did: lines 114 and 310
// on origin/develop held two independent copies of the same collapse).
export function runStateFromConclusion(conclusion: unknown): RunState {
  switch (runVerdictFor(conclusion)) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'failed';
    // A cancelled, stale or timed-out run says nothing about the code, and
    // unclassifiable data says nothing at all. Neither is evidence of failure.
    case 'indeterminate':
    case 'pending':
    case 'unclassified':
      return 'pending';
  }
}

export function runStateFor(
  runs: readonly RunRecord[],
  workflowName: string,
  headSha: string,
): RunState {
  const matches = runs
    .filter((r) => r.workflowName === workflowName && shaMatches(r.headSha, headSha))
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = matches[0];
  if (newest === undefined) return 'absent';
  if (newest.status !== 'completed') return 'pending';
  return runStateFromConclusion(newest.conclusion);
}

// See correlation rule 2 in the header: SHA matching is impossible for this run.
export function deployRunAfter(
  runs: readonly RunRecord[],
  afterIso: string,
): RunRecord | null {
  const cutoff = Date.parse(afterIso);
  const candidates = runs
    .filter((r) => r.workflowName === DEPLOY_WORKFLOW)
    .filter((r) => r.event === 'workflow_run')
    .filter((r) => Date.parse(r.createdAt) >= cutoff)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return candidates[0] ?? null;
}

export type PhaseName =
  | 'pr-checks'
  | 'pr-merged'
  | 'develop-gates'
  | 'promoted'
  | 'release'
  | 'main-e2e'
  | 'deploy';

export const PHASES: readonly PhaseName[] = [
  'pr-checks', 'pr-merged', 'develop-gates',
  'promoted', 'release', 'main-e2e', 'deploy',
];

export interface PhaseResult {
  readonly phase: PhaseName;
  readonly state: RunState;
}

export type Verdict = 'DEPLOYED' | 'WAITING' | 'FAILED';

export interface VerdictResult {
  readonly verdict: Verdict;
  readonly at: PhaseName | null;
  readonly exitCode: number;
}

export function computeVerdict(results: readonly PhaseResult[]): VerdictResult {
  const firstFailed = results.find((r) => r.state === 'failed');
  if (firstFailed !== undefined) {
    return { verdict: 'FAILED', at: firstFailed.phase, exitCode: 1 };
  }
  const firstUnfinished = results.find((r) => r.state !== 'success');
  if (firstUnfinished !== undefined) {
    return { verdict: 'WAITING', at: firstUnfinished.phase, exitCode: 2 };
  }
  // Every phase REPORTED is green; the chain is only done when every phase in
  // the canonical sequence has actually been reported.
  const seen = new Set(results.map((r) => r.phase));
  const missing = PHASES.find((p) => !seen.has(p));
  if (missing !== undefined) {
    return { verdict: 'WAITING', at: missing, exitCode: 2 };
  }
  return { verdict: 'DEPLOYED', at: null, exitCode: 0 };
}

// ---- side-effecting (entrypoint only) ----
// Everything above is pure and unit-tested. Only this section touches gh/git,
// mirroring release-promote.ts so the decision logic stays verifiable offline.
import { spawnSync } from 'node:child_process';

export const followConfigSchema = z.object({
  prNumber: z.number().int().positive(),
  developBranch: z.string().min(1).default('develop'),
  baseBranch: z.string().min(1).default('main'),
  // Total budget. The observed happy path is ~25 minutes (develop CI+E2E,
  // promote, release, main E2E, three service deploys plus smoke), so the
  // default leaves headroom without hanging a terminal forever.
  timeoutMinutes: z.number().int().positive().default(60),
  intervalSeconds: z.number().int().positive().default(30),
});
export type FollowConfig = z.infer<typeof followConfigSchema>;

function sh(cmd: string, args: readonly string[]): string {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.stdout + r.stderr;
}

function parseJsonAs<T>(raw: string, schema: z.ZodType<T>, fallback: T): T {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return fallback; }
  const res = schema.safeParse(parsed);
  return res.success ? res.data : fallback;
}

function listRuns(branch: string): readonly RunRecord[] {
  const raw = sh('gh', [
    'run', 'list', '--branch', branch, '--limit', '40',
    '--json', 'databaseId,workflowName,status,conclusion,headSha,createdAt,event',
  ]);
  return parseJsonAs(raw, RunListSchema, []);
}

// statusCheckRollup, never `gh pr checks`: the latter returns gh's bucketed
// rendering in which CANCELLED is indistinguishable from FAILURE, which is how
// PR #511 was reported as failing while carrying zero failures.
function listChecks(prNumber: number): readonly CheckRun[] {
  const raw = sh('gh', ['pr', 'view', String(prNumber), '--json', 'statusCheckRollup']);
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return []; }
  const obj = parsed as Record<string, unknown>;
  const res = CheckListSchema.safeParse(obj['statusCheckRollup']);
  return res.success ? res.data : [];
}

const prStateSchema = z.object({
  state: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable().optional(),
});

function prState(prNumber: number): { merged: boolean; mergeSha: string | null } {
  const raw = sh('gh', ['pr', 'view', String(prNumber), '--json', 'state,mergeCommit']);
  const res = prStateSchema.safeParse(JSON.parse(raw || '{}') as unknown);
  if (!res.success) return { merged: false, mergeSha: null };
  const merged = res.data.state === 'MERGED';
  const oid = res.data.mergeCommit?.oid ?? null;
  return { merged, mergeSha: merged ? oid : null };
}

// main contains the merge commit -> the promote actually happened. Ancestry is
// the only honest test: promote.yml opens and merges its own PR, so main HEAD is
// a different commit than our merge SHA.
function promotedShaFor(mergeSha: string, baseBranch: string): string | null {
  sh('git', ['fetch', 'origin', '--prune', '--quiet']);
  const contains = sh('git', ['branch', '-r', '--contains', mergeSha]);
  if (!contains.split(String.fromCharCode(10)).some((l) => l.trim() === 'origin/' + baseBranch)) {
    return null;
  }
  const head = sh('git', ['rev-parse', 'origin/' + baseBranch]).trim();
  return head.length >= 7 ? head : null;
}

function completedAt(runs: readonly RunRecord[], workflow: string, sha: string): string | null {
  const m = runs
    .filter((r) => r.workflowName === workflow && shaMatches(r.headSha, sha))
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return m === undefined ? null : m.createdAt;
}

function report(results: readonly PhaseResult[]): void {
  const icon = (s: RunState): string =>
    s === 'success' ? '\u2705' : s === 'failed' ? '\u274c' : s === 'pending' ? '\u23f3' : '\u2b1c';
  for (const p of PHASES) {
    const r = results.find((x) => x.phase === p);
    console.log('  ' + icon(r?.state ?? 'absent') + '  ' + p);
  }
}

function evaluate(cfg: FollowConfig): readonly PhaseResult[] {
  const out: PhaseResult[] = [];
  const checks = listChecks(cfg.prNumber);
  const sum = summarizeChecks(checks);
  // Indeterminate checks fall through to 'pending' by construction: they are in
  // neither `green` nor `failed`, so a superseded check keeps the follower
  // watching instead of declaring the PR broken.
  out.push({
    phase: 'pr-checks',
    state: sum.green ? 'success' : sum.failed.length > 0 ? 'failed' : 'pending',
  });
  if (sum.failed.length > 0) {
    console.log('     failing: ' + sum.failed.join(', '));
    return out;
  }
  if (sum.indeterminate.length > 0) {
    console.log('     superseded (needs re-run): ' + sum.indeterminate.join(', '));
  }
  if (sum.unclassified.length > 0) {
    console.log('     UNREADABLE checks: ' + sum.unclassified.join(', '));
  }

  const pr = prState(cfg.prNumber);
  out.push({ phase: 'pr-merged', state: pr.merged ? 'success' : 'pending' });
  if (!pr.merged || pr.mergeSha === null) return out;

  const devRuns = listRuns(cfg.developBranch);
  const ci = runStateFor(devRuns, CI_WORKFLOW, pr.mergeSha);
  const e2e = runStateFor(devRuns, E2E_WORKFLOW, pr.mergeSha);
  const gates: RunState =
    ci === 'failed' || e2e === 'failed' ? 'failed'
      : ci === 'success' && e2e === 'success' ? 'success'
        : 'pending';
  out.push({ phase: 'develop-gates', state: gates });
  if (gates !== 'success') return out;

  const mainSha = promotedShaFor(pr.mergeSha, cfg.baseBranch);
  out.push({ phase: 'promoted', state: mainSha === null ? 'pending' : 'success' });
  if (mainSha === null) return out;

  const mainRuns = listRuns(cfg.baseBranch);
  out.push({ phase: 'release', state: runStateFor(mainRuns, RELEASE_WORKFLOW, mainSha) });
  const mainE2e = runStateFor(mainRuns, E2E_WORKFLOW, mainSha);
  out.push({ phase: 'main-e2e', state: mainE2e });
  if (mainE2e !== 'success') return out;

  const gateAt = completedAt(mainRuns, E2E_WORKFLOW, mainSha);
  if (gateAt === null) return out;
  // The deploy is reported against the default branch, so query both refs and
  // correlate by time window rather than SHA (see correlation rule 2).
  const all = [...listRuns(cfg.baseBranch), ...listRuns(cfg.developBranch)];
  const dep = deployRunAfter(all, gateAt);
  const depState: RunState =
    dep === null ? 'absent'
      : dep.status !== 'completed' ? 'pending'
        : runStateFromConclusion(dep.conclusion);
  out.push({ phase: 'deploy', state: depState });
  if (dep !== null) {
    console.log('     deploy run: ' + String(dep.databaseId) + ' (' + dep.status + ')');
  }
  return out;
}

function main(): void {
  const arg = process.argv[2];
  if (arg === undefined || !/^[0-9]+$/.test(arg)) {
    console.error('usage: pnpm exec turbo run pr:follow -- <prNumber>');
    process.exit(1);
  }
  const cfg = followConfigSchema.parse({ prNumber: Number(arg) });
  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;
  console.log('following PR #' + String(cfg.prNumber) + ' to a Railway deploy ...');

  for (;;) {
    const results = evaluate(cfg);
    const v = computeVerdict(results);
    console.log('--- ' + new Date().toISOString() + ' ---');
    report(results);
    if (v.verdict !== 'WAITING') {
      console.log(v.verdict === 'DEPLOYED'
        ? 'DEPLOYED: PR #' + String(cfg.prNumber) + ' is live on Railway.'
        : 'FAILED at ' + String(v.at) + ' -- PR #' + String(cfg.prNumber) + ' did NOT reach production.');
      process.exit(v.exitCode);
    }
    if (Date.now() >= deadline) {
      console.error('TIMEOUT after ' + String(cfg.timeoutMinutes) + 'm, stalled at ' + String(v.at));
      process.exit(3);
    }
    console.log('  waiting at ' + String(v.at) + ' ...');
    sh('sleep', [String(cfg.intervalSeconds)]);
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { main(); }
