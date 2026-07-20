// packages/domain/src/delivery/rollout-verdict.ts
// Progressive-delivery rollout verdict SSOT. The vocabulary an automated canary
// analysis returns to a deployment controller after inspecting real production
// signals for a rollout stage:
//   promote      -> increase exposure to the next stage (e.g. 10% -> 25%)
//   hold         -> keep the current percentage; a guardrail is breaching but
//                   still under its failure budget, so the evidence that it is
//                   really failing is not yet conclusive
//   rollback     -> return traffic to the previous version
//   inconclusive -> the evidence could not be evaluated this round: a guarded
//                   metric was absent, or the query returned no data / NaN, or
//                   the query itself errored. This is deliberately NOT folded
//                   into rollback. The dominant 2026 controllers (Argo Rollouts
//                   analysis_types.go, OpsMx nanStrategy) separate a measurement
//                   that ran and violated (failureLimit) from one that could not
//                   be judged (inconclusiveLimit) from a query that errored
//                   (consecutiveErrorLimit), because an unreachable Prometheus
//                   must not be counted as an SLO breach and roll a healthy
//                   canary back on a transient scrape gap. inconclusive carries
//                   its own separate budget in the controller; a healthy round
//                   resets it.
// Cross-boundary: produced by the analysis engine, parsed by the controller and
// by CI. One frozen as-const array is the single definition; the type derives via
// (typeof VALUES)[number] and the schema via z.enum(VALUES).
import { z } from 'zod';

export const ROLLOUT_VERDICTS = Object.freeze([
  'promote',
  'hold',
  'rollback',
  'inconclusive',
] as const);

export type RolloutVerdict = (typeof ROLLOUT_VERDICTS)[number];

export const RolloutVerdictSchema = z.enum(ROLLOUT_VERDICTS);
