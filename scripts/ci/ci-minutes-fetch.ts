// scripts/ci/ci-minutes-fetch.ts
// Fetch layer for the CI-minutes audit: pulls workflow runs and their JOB
// records from the GitHub REST API and joins them into the RunEntry[] shape
// ci-minutes-audit.ts aggregates.
//
// Jobs, not timing: /actions/workflows/{id}/timing and /actions/runs/{id}/timing
// are closing down and return 0ms while billing shows five figures. Billable
// minutes are metered on JOB execution and rounded UP per job, so the job
// records ARE the ledger -- nothing else reproduces the bill.
//
// Pure exports below (URL building, pagination arithmetic, wire schemas, the
// run/jobs join) are INTENTIONALLY free of I/O -- the curl calls live in
// helpers used only by main(), mirroring resolve-ci-sha.ts:22 so the rules stay
// unit-testable without mocks.
//
// ENV READS USE BRACKET NOTATION (2026-08-08). process.env is an index
// signature, so dot access is TS4111 under noPropertyAccessFromIndexSignature.
// The flag keeps access syntax consistent with the declaration and stops a
// typo'd variable name from silently reading undefined -- which here would mean
// falling back to the public api.github.com or the default repo and auditing
// the wrong thing. Disabling the flag would clear the error by deleting the
// check.
//
// FOLLOW-UP, NOT THIS ARC: the 2026 practice is a single validated env module
// (one Zod schema parsed once, no direct process.env reads anywhere else).
// scripts/ has 13 files reading env with INCOMPATIBLE requiredness -- this one
// defaults GITHUB_API_URL, resolve-ci-sha demands a 40-hex GITHUB_SHA or exits,
// stack-up falls back to ~/Android/Sdk -- so one startup-parsed schema would
// make every script demand every variable. That needs per-script schemas and
// its own RED tests; bundling it into a type-debt burn-down would change
// failure modes in the deploy and audit paths.
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { JobSchema, type Job, type RunEntry, summarizeBillableMinutes } from './ci-minutes-audit.js';
import { BillingUsageSchema, linuxMinutesForRepo, reconcile } from './ci-minutes-reconcile.js';

export const PER_PAGE = 100;
const ACTIONS_API_VERSION = '2022-11-28';
const BILLING_API_VERSION = '2026-03-10';

// A workflow run, narrowed to what attribution needs. name is nullable at the
// wire; toRunEntries names it rather than dropping it.
export const WorkflowRunSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  run_started_at: z.string(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

// workflow_runs / jobs are REQUIRED keys: an absent key is a malformed payload,
// never an empty result. Same rule as the aggregator and the reconciler.
export const RunsPageSchema = z.object({
  total_count: z.number(),
  workflow_runs: z.array(WorkflowRunSchema),
});
export const JobsPageSchema = z.object({
  total_count: z.number(),
  jobs: z.array(JobSchema),
});

export function buildRunsUrl(apiUrl: string, repo: string, created: string, page: number): string {
  return apiUrl + '/repos/' + repo + '/actions/runs' +
    '?created=' + created +
    '&per_page=' + String(PER_PAGE) +
    '&page=' + String(page);
}

export function buildJobsUrl(apiUrl: string, repo: string, runId: number, page: number): string {
  return apiUrl + '/repos/' + repo + '/actions/runs/' + String(runId) + '/jobs' +
    '?per_page=' + String(PER_PAGE) +
    '&page=' + String(page);
}

// A full page means another may follow; a short or empty page ends it.
export function hasMorePages(received: number, perPage: number): boolean {
  return received >= perPage;
}

// The /actions/runs list endpoint hard-caps at 1000 results however you
// paginate, so a fetch that returns exactly the ceiling has probably hit the
// cap rather than exhausted the window (observed: July 2026 returned 1000/1000
// while billing showed 11,959 minutes). Accepting that silently would
// under-report the total and make the reconciliation meaningless -- the same
// class of failure as a confident zero: a plausible number that is not the
// truth. total_count is the wire stating how many runs really exist, so it is
// the check. Narrow the --created window and re-run when this fires.
export const RUNS_LIST_CEILING = 1000;

export function assertNotTruncated(fetched: number, totalCount: number): void {
  if (totalCount > fetched) {
    throw new Error(
      'runs list truncated: fetched ' + String(fetched) +
      ' of ' + String(totalCount) + ' total_count (API ceiling is ' +
      String(RUNS_LIST_CEILING) + '). Narrow --created and re-run; refusing to ' +
      'report a partial month as the whole bill.',
    );
  }
}

// Join runs to their jobs. A run with no jobs record THROWS: it may have billed
// minutes, and silently dropping it would under-report the very total this tool
// exists to reconcile.
export function toRunEntries(
  runs: readonly WorkflowRun[],
  jobsByRunId: ReadonlyMap<number, readonly Job[]>,
): RunEntry[] {
  return runs.map((run) => {
    const jobs = jobsByRunId.get(run.id);
    if (jobs === undefined) {
      throw new Error(
        'run ' + String(run.id) + ' has no jobs record -- refusing to drop a run ' +
        'that may have billed minutes',
      );
    }
    return {
      workflowName: run.name ?? '(unnamed workflow)',
      runId: run.id,
      jobs: [...jobs],
    };
  });
}

// --- side-effecting helpers, used only by main() ---

function ghGet(url: string, token: string, apiVersion: string): unknown {
  const r = spawnSync('curl', [
    '--silent', '--show-error', '--fail',
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'X-GitHub-Api-Version: ' + apiVersion,
    url,
  ], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error('GET ' + url + ' failed: ' + (r.stderr || '').trim());
  }
  try {
    return JSON.parse(r.stdout || '');
  } catch {
    throw new Error('GET ' + url + ' returned non-JSON');
  }
}

function fetchAllRuns(apiUrl: string, repo: string, created: string, token: string): WorkflowRun[] {
  const out: WorkflowRun[] = [];
  for (let page = 1; ; page += 1) {
    const payload = ghGet(buildRunsUrl(apiUrl, repo, created, page), token, ACTIONS_API_VERSION);
    const parsed = RunsPageSchema.parse(payload);
    out.push(...parsed.workflow_runs);
    process.stderr.write('[audit:ci-minutes] runs page ' + String(page) + ': +' +
      String(parsed.workflow_runs.length) + ' (total ' + String(out.length) + ')\n');
    if (!hasMorePages(parsed.workflow_runs.length, PER_PAGE)) {
      assertNotTruncated(out.length, parsed.total_count);
      break;
    }
  }
  return out;
}

function fetchJobsForRun(apiUrl: string, repo: string, runId: number, token: string): Job[] {
  const out: Job[] = [];
  for (let page = 1; ; page += 1) {
    const payload = ghGet(buildJobsUrl(apiUrl, repo, runId, page), token, ACTIONS_API_VERSION);
    const parsed = JobsPageSchema.parse(payload);
    out.push(...parsed.jobs);
    if (!hasMorePages(parsed.jobs.length, PER_PAGE)) break;
  }
  return out;
}

function fetchBilledMinutes(apiUrl: string, owner: string, repoName: string, year: number, month: number, token: string): number {
  const url = apiUrl + '/users/' + owner + '/settings/billing/usage?year=' +
    String(year) + '&month=' + String(month);
  const parsed = BillingUsageSchema.parse(ghGet(url, token, BILLING_API_VERSION));
  return linuxMinutesForRepo(parsed.usageItems, repoName);
}

function argOf(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback;
}

function main(): void {
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (!token) {
    console.error('audit:ci-minutes: GITHUB_TOKEN (or GH_TOKEN) required -- needs actions:read + billing scope');
    process.exit(1);
  }
  const apiUrl = process.env['GITHUB_API_URL'] ?? 'https://api.github.com';
  const repo = argOf('--repo', process.env['GITHUB_REPOSITORY'] ?? 'ltphongssvn/FleetManagement');
  const now = new Date();
  const year = Number(argOf('--year', String(now.getUTCFullYear())));
  const month = Number(argOf('--month', String(now.getUTCMonth() + 1)));
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const created = argOf('--created', String(year) + '-' + mm + '-01..' + String(year) + '-' + mm + '-' + String(lastDay));
  const owner = repo.split('/')[0] ?? '';
  const repoName = repo.split('/')[1] ?? '';

  process.stderr.write('[audit:ci-minutes] repo=' + repo + ' created=' + created + '\n');
  const runs = fetchAllRuns(apiUrl, repo, created, token);
  const jobsByRunId = new Map<number, Job[]>();
  let n = 0;
  for (const run of runs) {
    jobsByRunId.set(run.id, fetchJobsForRun(apiUrl, repo, run.id, token));
    n += 1;
    if (n % 25 === 0) process.stderr.write('[audit:ci-minutes] jobs fetched for ' + String(n) + '/' + String(runs.length) + ' runs\n');
  }
  const report = summarizeBillableMinutes(toRunEntries(runs, jobsByRunId));

  process.stdout.write('\nBillable minutes by workflow -- ' + repo + ' ' + created + '\n');
  process.stdout.write('-'.repeat(72) + '\n');
  for (const w of report.byWorkflow) {
    process.stdout.write(
      w.workflowName.padEnd(38) +
      String(w.billableMinutes).padStart(8) + ' min' +
      String(w.runs).padStart(7) + ' runs' +
      String(w.jobs).padStart(7) + ' jobs\n',
    );
  }
  process.stdout.write('-'.repeat(72) + '\n');
  process.stdout.write('COMPUTED TOTAL'.padEnd(38) + String(report.totalBillableMinutes).padStart(8) + ' min\n');

  // --no-reconcile: this window is one slice of a month, so comparing it to the
  // month total would always fail. Slices are summed by the caller and
  // reconciled once. Needed because /actions/runs caps at 1000 and July has
  // 1353 runs, so a whole month cannot be fetched in a single window.
  if (process.argv.includes('--no-reconcile')) {
    process.stdout.write('WINDOW_TOTAL ' + created + ' ' +
      String(report.totalBillableMinutes) + '\\n');
    return;
  }
  const billed = fetchBilledMinutes(apiUrl, owner, repoName, year, month, token);
  const rec = reconcile(report.totalBillableMinutes, billed, 0.05);
  process.stdout.write('BILLED (enhanced billing)'.padEnd(38) + String(billed).padStart(8) + ' min\n');
  process.stdout.write('DRIFT'.padEnd(38) + (rec.driftPct * 100).toFixed(2).padStart(8) + ' %  ' +
    (rec.ok ? 'RECONCILED' : 'OUT OF TOLERANCE -- instrument is wrong, do not size cuts on this') + '\n');
  if (!rec.ok) process.exit(2);
}

const isDirectInvocation = process.argv[1]?.endsWith('ci-minutes-fetch.ts');
if (isDirectInvocation) {
  main();
}
