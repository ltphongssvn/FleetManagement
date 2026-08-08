// scripts/check-conclusion.ts
//
// Single source of truth for interpreting GitHub check outcomes.
//
// WHY THIS EXISTS
// PR #511 sat unmergeable carrying ZERO failed checks. Two jobs were CANCELLED
// (superseded by a later push under `concurrency: cancel-in-progress: true`,
// which is correct CI configuration) and four were SKIPPED downstream of them.
// `pr:automerge` reported "BLOCKED: required checks failed" naming healthy jobs.
//
// The defect was NOT the classifier. It was the data source:
//   `gh pr checks --json name,state` returns gh's own BUCKETED rendering, in
//   which CANCELLED is indistinguishable from FAILURE (cli/cli#7551). The
//   information is destroyed before any code here can see it, so no wider
//   allow-list could have fixed it -- and widening one would have been worse,
//   silently passing runs that were cancelled because something broke.
//
// Read `gh pr view --json statusCheckRollup` instead: it carries the true
// per-check `conclusion`. Verified on PR #511 -- same PR, same moment, the two
// endpoints disagree, and only this one is faithful.
//
// NEVER reintroduce `gh pr checks` as a decision input. A guard test enforces this.
//
// TOTALITY, IN TWO LAYERS
// Layer 1 (compile time): CHECK_CONCLUSION_VERDICT is a total Record over the
// enum, and the switch ends in assertNever. Adding a member to CHECK_CONCLUSIONS
// without handling it is a TYPE ERROR, not a silent fall-through. Three of the
// nine members (CANCELLED, STALE, TIMED_OUT) are not defects at all, and STALE is
// set by GitHub itself -- so this class of false block would occur even with
// concurrency cancellation switched off.
//
// Layer 2 (runtime): the Record is indexed, and under noUncheckedIndexedAccess
// (tsconfig.base.json:25) an index read is `Verdict | undefined`. A caller that
// hands us an object which never went through CheckRunSchema -- a legacy
// {name, state} shape, say -- yields undefined. THAT ACTUALLY HAPPENED during
// this migration: unclassifiable checks were dropped from every bucket, so
// `failed` and `indeterminate` came back empty, `settled` was true, and the
// rollup reported GREEN. A genuinely failed check produced a MERGE. That is the
// inverse of the PR #511 defect and strictly more dangerous: a false block wastes
// time, a false merge ships broken code. Anything unclassifiable now lands in
// `unclassified`, which forbids green and forbids an automatic re-run.
import { z } from 'zod';

// https://docs.github.com/en/graphql/reference/enums#checkconclusionstate
// Mirrors gh's own CheckConclusionState constants; all nine members.
export const CHECK_CONCLUSIONS = [
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'NEUTRAL',
  'SKIPPED',
  'STALE',
  'STARTUP_FAILURE',
  'SUCCESS',
  'TIMED_OUT',
] as const;

export const CheckConclusionSchema = z.enum(CHECK_CONCLUSIONS);
export type CheckConclusion = z.infer<typeof CheckConclusionSchema>;

// Axis 1: parsed at the gh trust boundary. `conclusion` is null while a run is
// still in flight, which is a distinct case from every concluded outcome.
export const CheckRunSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: CheckConclusionSchema.nullable(),
});
export type CheckRun = z.infer<typeof CheckRunSchema>;

// pass          -- concluded, nothing wrong.
// fail          -- concluded, genuinely broken; a human must act.
// indeterminate -- concluded, but the outcome carries NO verdict about the code.
//                  The run was superseded, aged out, or timed out. The correct
//                  response is to RERUN, never to block.
// pending       -- not concluded yet. Poll again.
// unclassified  -- we could not tell. Never green, never auto-rerun. Fails closed.
export type Verdict = 'pass' | 'fail' | 'indeterminate' | 'pending' | 'unclassified';

export const CHECK_CONCLUSION_VERDICT: Record<CheckConclusion, Verdict> = {
  SUCCESS: 'pass',
  // SKIPPED and NEUTRAL are normal here: the promote dispatcher reports SKIPPED
  // on a feature PR by design.
  SKIPPED: 'pass',
  NEUTRAL: 'pass',
  FAILURE: 'fail',
  STARTUP_FAILURE: 'fail',
  ACTION_REQUIRED: 'fail',
  // Superseded by a newer push. Guaranteed to recur on every rapid second push.
  CANCELLED: 'indeterminate',
  // Set only by GitHub, and independent of our concurrency configuration.
  STALE: 'indeterminate',
  TIMED_OUT: 'indeterminate',
};

// Compile-time exhaustiveness. If a member is added to CHECK_CONCLUSIONS and left
// unhandled, `value` is no longer `never` here and tsc rejects the call.
function assertNever(value: never): Verdict {
  void value;
  return 'unclassified';
}

// Accepts unknown deliberately. summarizeRollup is exported, so a caller may pass
// data that never went through CheckRunSchema; refusing to model that is how the
// false-merge arose. Unrecognised input is classified, not dropped.
export function verdictFor(conclusion: unknown): Verdict {
  if (conclusion === null || conclusion === undefined) return 'pending';
  const parsed = CheckConclusionSchema.safeParse(conclusion);
  if (!parsed.success) return 'unclassified';
  const known: CheckConclusion = parsed.data;
  switch (known) {
    case 'SUCCESS':
    case 'SKIPPED':
    case 'NEUTRAL':
      return CHECK_CONCLUSION_VERDICT[known];
    case 'FAILURE':
    case 'STARTUP_FAILURE':
    case 'ACTION_REQUIRED':
      return CHECK_CONCLUSION_VERDICT[known];
    case 'CANCELLED':
    case 'STALE':
    case 'TIMED_OUT':
      return CHECK_CONCLUSION_VERDICT[known];
    default:
      return assertNever(known);
  }
}

export interface RollupSummary {
  readonly total: number;
  readonly passed: readonly string[];
  readonly failed: readonly string[];
  readonly indeterminate: readonly string[];
  readonly pending: readonly string[];
  readonly unclassified: readonly string[];
  readonly settled: boolean;
  readonly green: boolean;
  readonly needsRerun: boolean;
}

export function summarizeRollup(runs: readonly CheckRun[]): RollupSummary {
  const passed: string[] = [];
  const failed: string[] = [];
  const indeterminate: string[] = [];
  const pending: string[] = [];
  const unclassified: string[] = [];

  for (const run of runs) {
    // A caller may not have parsed; name is read defensively for the same reason.
    const name = typeof run.name === 'string' ? run.name : '(unnamed check)';
    switch (verdictFor(run.conclusion)) {
      case 'pass':
        passed.push(name);
        break;
      case 'fail':
        failed.push(name);
        break;
      case 'indeterminate':
        indeterminate.push(name);
        break;
      case 'pending':
        pending.push(name);
        break;
      case 'unclassified':
        unclassified.push(name);
        break;
    }
  }

  const settled = pending.length === 0;

  // Zero checks is NOT green. Preserved in spirit from pr-automerge.ts: the gate
  // has not registered yet, and treating an ungated PR as passing is the
  // confident-zero hazard that guard exists to kill. Unclassifiable checks block
  // green for the same reason -- absence of a known failure is not a pass.
  const green =
    settled &&
    failed.length === 0 &&
    indeterminate.length === 0 &&
    unclassified.length === 0 &&
    runs.length > 0;

  // A rerun is warranted only when nothing is genuinely broken, nothing is
  // unclassifiable, and the sole obstacle is an outcome carrying no verdict.
  // Never rerun over a real failure -- that is the treadmill this file exists to
  // end -- and never rerun over data we could not read.
  const needsRerun =
    settled && failed.length === 0 && unclassified.length === 0 && indeterminate.length > 0;

  return {
    total: runs.length,
    passed,
    failed,
    indeterminate,
    pending,
    unclassified,
    settled,
    green,
    needsRerun,
  };
}

// ---------------------------------------------------------------------------
// RUN-level conclusions (workflow runs), distinct from CHECK-level conclusions.
//
// pr-follow.ts watches workflow runs and collapsed them the same way checks were
// collapsed: `conclusion === 'success' ? 'success' : 'failed'`. A run cancelled by
// `concurrency: cancel-in-progress` therefore became 'failed', and computeVerdict
// turns a failed phase into a hard exit 1 -- so a superseded develop run reported
// FAILED for a pipeline that was never broken.
//
// Modelled as its own enum rather than reusing CheckConclusion: these are
// genuinely different GitHub types, and the run surface reports LOWERCASE values
// (`gh run list --json conclusion`) where the checks GraphQL surface reports
// uppercase. Merging them would be a guess dressed up as reuse. Matching is
// case-insensitive because the two surfaces disagree and both reach this code.
export const RUN_CONCLUSIONS = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
] as const;

export const RunConclusionSchema = z.enum(RUN_CONCLUSIONS);
export type RunConclusion = z.infer<typeof RunConclusionSchema>;

export const RUN_CONCLUSION_VERDICT: Record<RunConclusion, Verdict> = {
  success: 'pass',
  skipped: 'pass',
  neutral: 'pass',
  failure: 'fail',
  startup_failure: 'fail',
  action_required: 'fail',
  cancelled: 'indeterminate',
  stale: 'indeterminate',
  timed_out: 'indeterminate',
};

// Accepts unknown for the same reason verdictFor does: callers hold data straight
// off gh, and dropping an unrecognised value is what produced a false verdict once
// already. Unrecognised input is classified as unclassified, never as fail.
export function runVerdictFor(conclusion: unknown): Verdict {
  if (conclusion === null || conclusion === undefined) return 'pending';
  if (typeof conclusion !== 'string') return 'unclassified';
  const parsed = RunConclusionSchema.safeParse(conclusion.toLowerCase());
  if (!parsed.success) return 'unclassified';
  const known: RunConclusion = parsed.data;
  switch (known) {
    case 'success':
    case 'skipped':
    case 'neutral':
      return RUN_CONCLUSION_VERDICT[known];
    case 'failure':
    case 'startup_failure':
    case 'action_required':
      return RUN_CONCLUSION_VERDICT[known];
    case 'cancelled':
    case 'stale':
    case 'timed_out':
      return RUN_CONCLUSION_VERDICT[known];
    default:
      return assertNever(known);
  }
}
