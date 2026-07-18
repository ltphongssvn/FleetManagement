// packages/domain/src/delivery/rollout-analysis.ts
// The analysis engine: the pure function a deployment controller calls at each
// rollout stage to decide whether to raise exposure, wait, or return traffic to
// the previous version. This is the core of evidence-based promotion -- it turns
// real metric samples plus a breach history into promote, hold, or rollback.
//
// The verdict is a trichotomy, and the failure budget is what makes the middle
// case exist:
//   promote  -> every guardrail is satisfied this evaluation
//   hold     -> at least one guardrail breaches, but no metric has reached its
//               failureLimit of consecutive breaches: the evidence is real but
//               not yet conclusive, so keep the current exposure
//   rollback -> some metric has now breached failureLimit consecutive times
//
// Statelessness is deliberate. The engine does not remember previous evaluations;
// the controller owns the running consecutive-breach tally and passes it in as
// breachHistory. A breach this evaluation makes the effective count history+1,
// and reaching the limit is rollback. A clear evaluation tells the controller to
// reset that metric to zero -- the engine reports the clear, the controller drops
// the count -- so a flaky single breach cannot accumulate across recoveries.
//
// Missing evidence is a breach, not a pass. A guardrail whose metric is absent
// from the samples cannot be shown healthy, so it counts as breaching. A metrics
// pipeline that silently stopped reporting must never read as promote.
//
// Inputs are already validated (RolloutMetrics / GuardrailSet), so this is
// trusted internal data past the trust boundary: the engine type-checks it and
// does not re-parse. Axis-1 does not fire on data our own validated code produced.
import type { RolloutVerdict } from './rollout-verdict.js';
import type { Guardrail, GuardrailSet } from './rollout-guardrail.js';
import type { RolloutMetrics } from './rollout-metrics.js';

/** Consecutive-breach counts per metric, carried by the controller across evaluations. */
export type BreachHistory = Readonly<Record<string, number>>;

/** True when the sample violates the guardrail bound. An absent sample cannot be shown healthy. */
function isBreaching(guardrail: Guardrail, value: number | undefined): boolean {
  if (value === undefined) return true;
  if (guardrail.min !== undefined && value < guardrail.min) return true;
  if (guardrail.max !== undefined && value > guardrail.max) return true;
  return false;
}

/**
 * Decide promote, hold, or rollback for one evaluation. Pure and stateless: the
 * same metrics, guardrails, and breach history always yield the same verdict.
 */
export function decideRollout(
  metrics: RolloutMetrics,
  guardrails: GuardrailSet,
  breachHistory: BreachHistory,
): RolloutVerdict {
  const valueByMetric = new Map(metrics.map((sample) => [sample.metric, sample.value]));

  let anyBreaching = false;

  for (const guardrail of guardrails) {
    if (!isBreaching(guardrail, valueByMetric.get(guardrail.metric))) continue;
    anyBreaching = true;
    const consecutive = (breachHistory[guardrail.metric] ?? 0) + 1;
    if (consecutive >= guardrail.failureLimit) return 'rollback';
  }

  return anyBreaching ? 'hold' : 'promote';
}
