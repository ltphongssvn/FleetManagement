// scripts/pr-automerge.ts
// Merge an open PR the instant its ruleset-required checks go green -- the fix
// for the pr-merged stall that pr:follow reports.
//
// Why this is a synchronous poll-then-merge, NOT gh pr merge --auto:
// GitHub native auto-merge is documented as unreliable when the required checks
// and approvals come from repository RULESETS rather than classic branch
// protection (community discussion #162623, still open in 2026): --auto enables,
// every check goes green, and the merge simply never fires -- recreating the
// exact stall this task exists to remove. This repo gates develop and main with
// rulesets (develop-protection 18237884, main-protection 18237898), so the
// sanctioned workaround is to poll mergeStateStatus + the checks and, once the
// ruleset is satisfied, merge synchronously via gh pr merge --merge. That path
// respects the ruleset (GitHub still refuses if a required check is red) but does
// not depend on the broken --auto trigger.
//
// MERGE STRATEGY IS --merge (a true merge commit), NEVER --squash or --rebase.
// The promote pipeline relies on SHA-based ancestry (merge-base --is-ancestor,
// branch --contains) to know a fix landed; a true merge preserves the original
// commit SHAs in develop history, keeping that traceability reliable forever.
// Squash or rebase would rewrite SHAs and silently break the promote checks.
//
// BEHIND handling (the gap the dogfood exposed): the develop-protection ruleset
// requires the branch be up to date before merge. In a many-worktree repo develop
// moves constantly, so a green PR is almost always BEHIND. A passive wait there
// stalls to TIMEOUT forever, because nothing updates the branch. The task instead
// ACTS on BEHIND: gh pr update-branch (never --rebase, immutable history), which
// merges the base in and starts a fresh CI run, then keeps polling.
//
// CHECK SOURCE IS statusCheckRollup, NEVER `gh pr checks` (the PR #511 defect).
// `gh pr checks --json name,state` returns gh's BUCKETED rendering, in which a
// CANCELLED check is indistinguishable from a FAILURE (cli/cli#7551). PR #511 was
// reported "BLOCKED: required checks failed" while carrying ZERO failures: two
// jobs were CANCELLED by correct `concurrency: cancel-in-progress` configuration
// and four were SKIPPED downstream of them. The information was destroyed before
// this file could see it, so no classifier here could have recovered it.
// statusCheckRollup carries the true per-check `conclusion`. A guard test
// (gh-pr-checks-banned.guard.test.ts) makes reintroducing the old call a failure.
//
// Contained on purpose: it acts ONLY on the PR's base (feature -> develop), never
// promotes develop -> main, so it cannot race promote.yml -- the same boundary
// pr-follow.ts and release-promote.ts observe. A merge queue would also solve the
// ruleset problem, but merge queues are unavailable on user-owned repositories
// (GitHub restricts them to org-owned public repos and GHEC private repos), so
// this task is not a stopgap for a queue -- it is the only available mechanism.
//
// Pure cores (decideAutoMerge, decideMergeReady) are unit-tested offline; only the
// entrypoint touches gh, the same split as pr-follow.ts.
import { z } from 'zod';
import { CheckRunSchema, summarizeRollup } from './check-conclusion.js';
import type { CheckRun, RollupSummary } from './check-conclusion.js';

// ---- trust boundary (Axis 1): everything gh hands us is parsed ----

// Axis 2: the check shape is owned by check-conclusion.ts. Re-exported so the
// existing spec and any future consumer keep one import site, not two.
export { CheckRunSchema };
export type { CheckRun };
export const CheckListSchema = z.array(CheckRunSchema);

export const PrViewSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  isDraft: z.boolean(),
  mergeable: z.string(),
  autoMergeEnabled: z.boolean().optional(),
});
export type PrView = z.infer<typeof PrViewSchema>;

// ---- pure decision core: preconditions ----

export type AutoMergeAction = 'ENABLE' | 'SKIP' | 'BLOCKED';
export interface AutoMergeDecision {
  readonly action: AutoMergeAction;
  readonly reason: string;
}

// Precondition guard, evaluated once before polling. ENABLE means the PR is a
// legitimate auto-merge candidate (open, non-draft, not already conflicting); it
// does NOT mean checks are green -- that is decideMergeReady's job each poll.
// UNKNOWN mergeability is allowed through: GitHub computes it asynchronously and
// re-checks at merge time, so a freshly pushed PR reporting UNKNOWN is fine.
export function decideAutoMerge(pr: PrView): AutoMergeDecision {
  const state = pr.state.toUpperCase();
  if (state === 'MERGED') return { action: 'SKIP', reason: 'PR is already merged' };
  if (state === 'CLOSED') return { action: 'SKIP', reason: 'PR is closed' };
  if (pr.autoMergeEnabled === true) {
    return { action: 'SKIP', reason: 'auto-merge is already enabled on this PR' };
  }
  const blockers: string[] = [];
  if (pr.isDraft) blockers.push('PR is a draft');
  if (pr.mergeable.toUpperCase() === 'CONFLICTING') blockers.push('PR has merge conflicts');
  if (blockers.length > 0) return { action: 'BLOCKED', reason: blockers.join('; ') };
  return { action: 'ENABLE', reason: 'open, non-draft, no conflicts -- will merge when green' };
}

// ---- pure decision core: check readiness ----

// CheckSummary is RollupSummary. Classification lives in check-conclusion.ts so
// pr-automerge.ts and pr-follow.ts cannot drift apart again -- they held verbatim
// duplicate PASSING_CHECK_STATES sets, and the CANCELLED bug was present in both.
export type CheckSummary = RollupSummary;

export function summarizeChecks(checks: readonly CheckRun[]): CheckSummary {
  return summarizeRollup(checks);
}

export type MergeReadyAction = 'MERGE' | 'UPDATE' | 'RERUN' | 'WAIT' | 'BLOCKED';
export interface MergeReadyDecision {
  readonly action: MergeReadyAction;
  readonly reason: string;
}

// Decide, on one poll, whether to merge now. Pure.
//   BLOCKED -- a check GENUINELY failed, or GitHub reports the PR DIRTY: merging
//              is impossible until a human intervenes.
//   RERUN   -- nothing failed, but one or more checks concluded CANCELLED, STALE
//              or TIMED_OUT. Those carry NO verdict about the code. Re-run them.
//              Ordered BEFORE the green test: an indeterminate check is not green
//              and must not be silently waited on forever.
//   UPDATE  -- checks green but the branch is BEHIND base; the ruleset requires
//              up-to-date, so update the branch (triggers fresh CI) and re-poll.
//   WAIT    -- checks still pending, none registered yet, or mergeStateStatus not
//              yet resolved (UNKNOWN/BLOCKED): poll again.
//   MERGE   -- every check green AND GitHub says the PR is mergeable now.
export function decideMergeReady(
  sum: CheckSummary,
  mergeStateStatus: string,
): MergeReadyDecision {
  const mss = mergeStateStatus.toUpperCase();
  if (sum.failed.length > 0) {
    return { action: 'BLOCKED', reason: 'required checks failed: ' + sum.failed.join(', ') };
  }
  if (mss === 'DIRTY') {
    return { action: 'BLOCKED', reason: 'PR has merge conflicts (DIRTY)' };
  }
  if (sum.needsRerun) {
    return { action: 'RERUN', reason: 'no failures; superseded or stale checks need a re-run: ' +
      sum.indeterminate.join(', ') };
  }
  if (!sum.green) {
    return { action: 'WAIT', reason: sum.total === 0
      ? 'no checks registered yet'
      : 'checks pending: ' + sum.pending.join(', ') };
  }
  // Checks are green. GitHub still gates on the ruleset via mergeStateStatus.
  // CLEAN or HAS_HOOKS means ready to merge now.
  if (mss === 'CLEAN' || mss === 'HAS_HOOKS') {
    return { action: 'MERGE', reason: 'all checks green and PR mergeable' };
  }
  // BEHIND means the develop-protection ruleset requires the branch be current
  // before merge -- the common case in a many-worktree repo where develop moves
  // constantly. Update the branch (gh pr update-branch, never --rebase) rather
  // than wait forever for a state nothing will change. This was the gap the
  // dogfood exposed: a passive WAIT here stalled to TIMEOUT on a BEHIND PR.
  if (mss === 'BEHIND') {
    return { action: 'UPDATE', reason: 'checks green but branch BEHIND; updating branch with base' };
  }
  // BLOCKED/UNKNOWN/other: GitHub has not recomputed since the last green check,
  // or a non-check rule is unmet. Poll again rather than force it.
  return { action: 'WAIT', reason: 'checks green; waiting on mergeState (' + mergeStateStatus + ')' };
}

// ---- side-effecting (entrypoint only) ----
// Everything above is pure and unit-tested. Only this section touches gh.
import { spawnSync } from 'node:child_process';

const nl = String.fromCharCode(10);

export const automergeConfigSchema = z.object({
  prNumber: z.number().int().positive(),
  timeoutMinutes: z.number().int().positive().default(30),
  intervalSeconds: z.number().int().positive().default(30),
  maxReruns: z.number().int().nonnegative().default(2),
});
export type AutomergeConfig = z.infer<typeof automergeConfigSchema>;

function sh(cmd: string, args: readonly string[]): { out: string; code: number } {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { out: r.stdout + r.stderr, code: r.status ?? 1 };
}

// A rollup we could not parse is NOT an empty rollup. Returning [] for both made
// a malformed gh response indistinguishable from a PR with no checks registered,
// which decideMergeReady renders as an indefinite WAIT until TIMEOUT. null lets
// the caller keep waiting without ever mistaking garbage for a settled state.
function listChecks(prNumber: number): readonly CheckRun[] | null {
  const r = sh('gh', ['pr', 'view', String(prNumber), '--json', 'statusCheckRollup']);
  let raw: unknown;
  try { raw = JSON.parse(r.out) as unknown; } catch { return null; }
  const obj = raw as Record<string, unknown>;
  const res = CheckListSchema.safeParse(obj['statusCheckRollup']);
  return res.success ? res.data : null;
}

function viewPr(prNumber: number): { pr: PrView | null; mergeStateStatus: string } {
  const r = sh('gh', [
    'pr', 'view', String(prNumber),
    '--json', 'number,state,isDraft,mergeable,mergeStateStatus,autoMergeRequest',
  ]);
  let raw: unknown;
  try { raw = JSON.parse(r.out) as unknown; } catch { return { pr: null, mergeStateStatus: 'UNKNOWN' }; }
  const obj = raw as Record<string, unknown>;
  const normalised = {
    number: obj['number'],
    state: obj['state'],
    isDraft: obj['isDraft'],
    mergeable: obj['mergeable'],
    autoMergeEnabled: obj['autoMergeRequest'] !== null && obj['autoMergeRequest'] !== undefined,
  };
  const res = PrViewSchema.safeParse(normalised);
  const mss = typeof obj['mergeStateStatus'] === 'string' ? obj['mergeStateStatus'] : 'UNKNOWN';
  return { pr: res.success ? res.data : null, mergeStateStatus: mss };
}

function main(): number {
  const arg = process.argv[2];
  if (arg === undefined || !/^[0-9]+$/.test(arg)) {
    process.stderr.write('usage: pnpm exec turbo run pr:automerge -- <prNumber>' + nl);
    return 1;
  }
  const cfg = automergeConfigSchema.parse({ prNumber: Number(arg) });
  const first = viewPr(cfg.prNumber);
  if (first.pr === null) {
    process.stderr.write('[pr:automerge] could not read PR #' + String(cfg.prNumber) + nl);
    return 1;
  }
  const pre = decideAutoMerge(first.pr);
  process.stdout.write('[pr:automerge] PR #' + String(cfg.prNumber) + ': ' + pre.action +
    ' -- ' + pre.reason + nl);
  if (pre.action === 'SKIP') return 0;
  if (pre.action === 'BLOCKED') return 1;

  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;
  let reruns = 0;
  for (;;) {
    const checks = listChecks(cfg.prNumber);
    const view = viewPr(cfg.prNumber);
    if (view.pr !== null && view.pr.state.toUpperCase() === 'MERGED') {
      process.stdout.write('[pr:automerge] PR #' + String(cfg.prNumber) + ' is merged.' + nl);
      return 0;
    }
    if (checks === null) {
      process.stdout.write('--- ' + new Date().toISOString() +
        ' --- WAIT: could not parse statusCheckRollup; re-reading.' + nl);
    } else {
      const ready = decideMergeReady(summarizeChecks(checks), view.mergeStateStatus);
      process.stdout.write('--- ' + new Date().toISOString() + ' --- ' + ready.action +
        ': ' + ready.reason + nl);
      if (ready.action === 'BLOCKED') {
        process.stderr.write('[pr:automerge] BLOCKED -- ' + ready.reason + nl);
        return 1;
      }
      if (ready.action === 'RERUN') {
        // Bounded: a superseded run is worth re-running, an endlessly re-cancelled
        // one is a signal to stop, not a loop to spin in.
        if (reruns >= cfg.maxReruns) {
          process.stderr.write('[pr:automerge] BLOCKED -- checks keep concluding without a ' +
            'verdict after ' + String(reruns) + ' re-runs: ' + ready.reason + nl);
          return 1;
        }
        reruns += 1;
        const rr = sh('gh', ['run', 'rerun', '--failed', '--job-summary-fallback']);
        process.stdout.write(rr.out);
      }
      if (ready.action === 'UPDATE') {
        const u = sh('gh', ['pr', 'update-branch', String(cfg.prNumber)]);
        process.stdout.write(u.out);
        // update-branch merges base in and starts a fresh CI run; keep polling.
      }
      if (ready.action === 'MERGE') {
        // --merge (a true merge commit), never --squash/--rebase: preserves the
        // original commit SHAs in develop history so the promote pipeline SHA
        // ancestry checks stay reliable.
        const m = sh('gh', ['pr', 'merge', String(cfg.prNumber), '--merge']);
        process.stdout.write(m.out);
        if (m.code === 0) {
          process.stdout.write('[pr:automerge] merged PR #' + String(cfg.prNumber) + '.' + nl);
          return 0;
        }
        // gh can transiently refuse if GitHub has not finished recomputing the
        // ruleset; fall through to another poll rather than failing hard.
        process.stdout.write('[pr:automerge] merge refused this round; will retry.' + nl);
      }
    }
    if (Date.now() >= deadline) {
      process.stderr.write('[pr:automerge] TIMEOUT after ' + String(cfg.timeoutMinutes) +
        'm without merging PR #' + String(cfg.prNumber) + nl);
      return 3;
    }
    sh('sleep', [String(cfg.intervalSeconds)]);
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { process.exit(main()); }
