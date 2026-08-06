// packages/domain/src/delivery/rollout-history.ts
// Phase 6-stateful slice 1: the pure tally update that makes both rollout budgets
// actually accumulate.
//
// Why this exists. decideRollout is stateless by design: it READS breachHistory
// and inconclusiveHistory and never advances them. rollout-controller.ts carried
// breachHistory in RolloutState but only ever CLEARED it, and did not carry
// inconclusiveHistory at all. The consequence was silent and serious -- both
// budgets sat permanently at zero, so a metric could breach every round without
// failureLimit ever being reached, and a metric that never reported could never
// exhaust the inconclusive budget. The engine documented two budgets that could
// not fill. This module is the missing step.
//
// It stays SEPARATE from decideRollout on purpose. The decision must remain a
// function of state, not a mutation of it: the caller evaluates, then advances the
// tallies with the same metrics and guardrails, then persists both alongside the
// rollout state. Folding the update into the decision would make a verdict depend
// on how many times it had been asked for.
//
// The rules, which mirror the two-budget model in rollout-analysis.ts:
//   breach -> the breach count increments; the inconclusive count RESETS, because
//             the round was evaluable: we read the metric and it violated a bound.
//   absent -> the inconclusive count increments; the breach count RESETS, because
//             nothing was actually observed to violate anything.
//   pass   -> both reset. Consecutive means consecutive, and one clean round is
//             what breaks a streak; carrying a stale count would roll back a
//             recovered canary on evidence from before it recovered.
//
// Only guarded metrics are tallied, and zero counts are dropped rather than
// stored, so a history is exactly the set of metrics currently in a streak.
import type { Guardrail, GuardrailSet } from './rollout-guardrail.js';
import type { RolloutMetrics } from './rollout-metrics.js';
import type { BreachHistory, InconclusiveHistory } from './rollout-analysis.js';

/** Both tallies after one evaluation, ready to persist with the rollout state. */
export interface RolloutHistories {
  readonly breachHistory: BreachHistory;
  readonly inconclusiveHistory: InconclusiveHistory;
}

/** How one guardrail evaluated this round. Mirrors the analysis engine vocabulary. */
type GuardrailOutcome = 'pass' | 'breach' | 'absent';

function evaluate(guardrail: Guardrail, value: number | undefined): GuardrailOutcome {
  if (value === undefined) return 'absent';
  if (guardrail.min !== undefined && value < guardrail.min) return 'breach';
  if (guardrail.max !== undefined && value > guardrail.max) return 'breach';
  return 'pass';
}

/**
 * Advance both consecutive-count tallies by one evaluation. Pure: the inputs are
 * never mutated and the same arguments always produce the same histories.
 *
 * Pass the SAME metrics and guardrails that were handed to decideRollout, so the
 * verdict and the tallies describe one round rather than two different ones.
 */
export function updateHistories(
  metrics: RolloutMetrics,
  guardrails: GuardrailSet,
  breachHistory: BreachHistory,
  inconclusiveHistory: InconclusiveHistory,
): RolloutHistories {
  const valueByMetric = new Map(metrics.map((sample) => [sample.metric, sample.value]));
  const nextBreach: Record<string, number> = {};
  const nextInconclusive: Record<string, number> = {};

  for (const guardrail of guardrails) {
    const outcome = evaluate(guardrail, valueByMetric.get(guardrail.metric));
    if (outcome === 'breach') {
      nextBreach[guardrail.metric] = (breachHistory[guardrail.metric] ?? 0) + 1;
    } else if (outcome === 'absent') {
      nextInconclusive[guardrail.metric] = (inconclusiveHistory[guardrail.metric] ?? 0) + 1;
    }
    // pass: write neither, which is the reset -- a zero count is an absent key.
  }

  return { breachHistory: nextBreach, inconclusiveHistory: nextInconclusive };
}
