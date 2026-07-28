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
// ruleset is satisfied, merge synchronously via gh pr merge --squash. That path
// respects the ruleset (GitHub still refuses if a required check is red) but does
// not depend on the broken --auto trigger.
//
// BEHIND handling (the gap the dogfood exposed): the develop-protection ruleset
// requires the branch be up to date before merge. In a many-worktree repo develop
// moves constantly, so a green PR is almost always BEHIND. A passive wait there
// stalls to TIMEOUT forever, because nothing updates the branch. The task instead
// ACTS on BEHIND: gh pr update-branch (never --rebase, immutable history), which
// merges the base in and starts a fresh CI run, then keeps polling.
//
// Contained on purpose: it acts ONLY on the PR's base (feature -> develop), never
// promotes develop -> main, so it cannot race promote.yml -- the same boundary
// pr-follow.ts and release-promote.ts observe. A merge queue would also solve the
// ruleset problem, but that is a repo-wide governance change affecting every
// worktree and needs merge_group CI wiring; this task is the minimal contained fix.
//
// Pure cores (decideAutoMerge, decideMergeReady) are unit-tested offline; only the
// entrypoint touches gh, the same split as pr-follow.ts.
import { z } from 'zod';

// ---- trust boundary (Axis 1): everything gh hands us is parsed ----

export const CheckRunSchema = z.object({ name: z.string(), state: z.string() });
export type CheckRun = z.infer<typeof CheckRunSchema>;
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

// ---- pure decision core: check readiness (reuses pr-follow.ts semantics) ----

// A finished, non-failing check. SKIPPED and NEUTRAL are normal: the promote
// dispatcher reports SKIPPED on a feature PR by design.
const PASSING_CHECK_STATES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const PENDING_CHECK_STATES = new Set([
  'PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED',
]);

export interface CheckSummary {
  readonly total: number;
  readonly pending: readonly string[];
  readonly failed: readonly string[];
  readonly settled: boolean;
  readonly green: boolean;
}

export function summarizeChecks(checks: readonly CheckRun[]): CheckSummary {
  const pending: string[] = [];
  const failed: string[] = [];
  for (const c of checks) {
    const state = c.state.toUpperCase();
    if (PENDING_CHECK_STATES.has(state)) pending.push(c.name);
    else if (!PASSING_CHECK_STATES.has(state)) failed.push(c.name);
  }
  const settled = pending.length === 0;
  // Zero checks is NOT green: the gate has not registered yet, and treating an
  // ungated PR as passing is the confident-zero hazard this guard exists to kill.
  const green = settled && failed.length === 0 && checks.length > 0;
  return { total: checks.length, pending, failed, settled, green };
}

export type MergeReadyAction = 'MERGE' | 'UPDATE' | 'WAIT' | 'BLOCKED';
export interface MergeReadyDecision {
  readonly action: MergeReadyAction;
  readonly reason: string;
}

// Decide, on one poll, whether to merge now. Pure.
//   BLOCKED -- a required check FAILED, or GitHub reports the PR DIRTY: merging is
//              impossible until a human intervenes.
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
});
export type AutomergeConfig = z.infer<typeof automergeConfigSchema>;

function sh(cmd: string, args: readonly string[]): { out: string; code: number } {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { out: r.stdout + r.stderr, code: r.status ?? 1 };
}

function parseJsonAs<T>(raw: string, schema: z.ZodType<T>, fallback: T): T {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return fallback; }
  const res = schema.safeParse(parsed);
  return res.success ? res.data : fallback;
}

function listChecks(prNumber: number): readonly CheckRun[] {
  const r = sh('gh', ['pr', 'checks', String(prNumber), '--json', 'name,state']);
  return parseJsonAs(r.out, CheckListSchema, []);
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
  for (;;) {
    const sum = summarizeChecks(listChecks(cfg.prNumber));
    const view = viewPr(cfg.prNumber);
    if (view.pr !== null && view.pr.state.toUpperCase() === 'MERGED') {
      process.stdout.write('[pr:automerge] PR #' + String(cfg.prNumber) + ' is merged.' + nl);
      return 0;
    }
    const ready = decideMergeReady(sum, view.mergeStateStatus);
    process.stdout.write('--- ' + new Date().toISOString() + ' --- ' + ready.action +
      ': ' + ready.reason + nl);
    if (ready.action === 'BLOCKED') {
      process.stderr.write('[pr:automerge] BLOCKED -- ' + ready.reason + nl);
      return 1;
    }
    if (ready.action === 'UPDATE') {
      const u = sh('gh', ['pr', 'update-branch', String(cfg.prNumber)]);
      process.stdout.write(u.out);
      // update-branch merges base in and starts a fresh CI run; keep polling.
    }
    if (ready.action === 'MERGE') {
      const m = sh('gh', ['pr', 'merge', String(cfg.prNumber), '--squash']);
      process.stdout.write(m.out);
      if (m.code === 0) {
        process.stdout.write('[pr:automerge] merged PR #' + String(cfg.prNumber) + '.' + nl);
        return 0;
      }
      // gh can transiently refuse if GitHub has not finished recomputing the
      // ruleset; fall through to another poll rather than failing hard.
      process.stdout.write('[pr:automerge] merge refused this round; will retry.' + nl);
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
