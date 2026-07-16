// packages/domain/src/delivery/rollout-verdict.ts
// Progressive-delivery rollout verdict SSOT. The vocabulary an automated canary
// analysis returns to a deployment controller after inspecting real production
// signals for a rollout stage:
//   promote  -> increase exposure to the next stage (e.g. 10% -> 25%)
//   hold     -> keep the current percentage; evidence is not yet conclusive
//   rollback -> return traffic to the previous version
// Cross-boundary: produced by the analysis engine, parsed by the controller and
// by CI. One frozen as-const array is the single definition; the type derives via
// (typeof VALUES)[number] and the schema via z.enum(VALUES).
import { z } from 'zod';

export const ROLLOUT_VERDICTS = Object.freeze([
  'promote',
  'hold',
  'rollback',
] as const);

export type RolloutVerdict = (typeof ROLLOUT_VERDICTS)[number];

export const RolloutVerdictSchema = z.enum(ROLLOUT_VERDICTS);
