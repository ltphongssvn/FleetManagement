// packages/domain/src/delivery/rollout-analysis.ts
// The analysis engine: the pure function a deployment controller calls at each
// rollout stage to decide whether to raise exposure, wait, roll back, or treat
// the round as inconclusive. It turns real metric samples plus two running
// tallies into one of four verdicts.
//
// The design follows the model the dominant 2026 controllers use (Argo Rollouts
// analysis_types.go, OpsMx nanStrategy), which is the whole point of this engine:
// a measurement that RAN AND VIOLATED its bound and a measurement that COULD NOT
// BE EVALUATED are different facts and must not share a budget. Folding no-data
// into failure lets a metrics pipeline that stopped reporting -- or a Prometheus
// that returned an empty vector -- roll a healthy canary back as if it had
// breached an SLO. So this engine tracks two budgets:
//   failureLimit (per guardrail)  -> consecutive real bound-violations
//   the inconclusive budget       -> consecutive rounds a metric could not be
//                                    evaluated (absent from the samples)
//
// Verdict precedence, strongest first:
//   rollback     -> a real breach reached failureLimit, OR the inconclusive
//                   budget is exhausted (a canary that can never be evaluated is
//                   as unshippable as one that is failing)
//   hold         -> a real breach is present but under failureLimit
//   inconclusive -> no real breach, but a guarded metric was absent and the
//                   inconclusive budget is not yet exhausted
//   promote      -> every guarded metric was present and within its bound
//
// A real breach outranks an inconclusive one: if any metric is genuinely
// violating we act on that signal rather than waiting on the missing one.
//
// Stateless and pure. The controller owns both tallies and passes them in; a
// breach or absence this round makes the effective count history+1, and a clean
// round is the controller signal to reset. Inputs are already validated
// (RolloutMetrics / GuardrailSet), so the engine type-checks and does not
// re-parse: trusted internal data past the boundary.
import type { RolloutVerdict } from './rollout-verdict.js';
import type { Guardrail, GuardrailSet } from './rollout-guardrail.js';
import type { RolloutMetrics } from './rollout-metrics.js';

/** Consecutive counts per metric, carried by the controller across evaluations. */
export type BreachHistory = Readonly<Record<string, number>>;

/**
 * Consecutive rounds a metric could not be evaluated, carried the same way as
 * BreachHistory. Kept a distinct type name so a caller cannot pass one where the
 * other is meant.
 */
export type InconclusiveHistory = Readonly<Record<string, number>>;

/**
 * Default consecutive inconclusive rounds tolerated before rollback. Argo defaults
 * inconclusiveLimit low; we mirror the failure budget rung count so a metric that
 * never reports is not tolerated indefinitely.
 */
export const DEFAULT_INCONCLUSIVE_LIMIT = 3;

/** How a single guardrail evaluated against the samples this round. */
type GuardrailOutcome = 'pass' | 'breach' | 'absent';

function evaluate(guardrail: Guardrail, value: number | undefined): GuardrailOutcome {
  if (value === undefined) return 'absent';
  if (guardrail.min !== undefined && value < guardrail.min) return 'breach';
  if (guardrail.max !== undefined && value > guardrail.max) return 'breach';
  return 'pass';
}

/**
 * Decide promote, hold, rollback, or inconclusive for one evaluation. Pure and
 * stateless: the same metrics, guardrails, and histories always yield the same
 * verdict.
 */
export function decideRollout(
  metrics: RolloutMetrics,
  guardrails: GuardrailSet,
  breachHistory: BreachHistory,
  inconclusiveHistory: InconclusiveHistory,
  inconclusiveLimit: number = DEFAULT_INCONCLUSIVE_LIMIT,
): RolloutVerdict {
  const valueByMetric = new Map(metrics.map((sample) => [sample.metric, sample.value]));

  let anyBreaching = false;
  let anyAbsent = false;

  for (const guardrail of guardrails) {
    const outcome = evaluate(guardrail, valueByMetric.get(guardrail.metric));

    if (outcome === 'breach') {
      anyBreaching = true;
      const consecutive = (breachHistory[guardrail.metric] ?? 0) + 1;
      if (consecutive >= guardrail.failureLimit) return 'rollback';
    } else if (outcome === 'absent') {
      anyAbsent = true;
      const consecutive = (inconclusiveHistory[guardrail.metric] ?? 0) + 1;
      if (consecutive >= inconclusiveLimit) return 'rollback';
    }
  }

  if (anyBreaching) return 'hold';
  if (anyAbsent) return 'inconclusive';
  return 'promote';
}
