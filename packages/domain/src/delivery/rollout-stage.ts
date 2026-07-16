// packages/domain/src/delivery/rollout-stage.ts
// Progressive-delivery rollout ladder SSOT. A ladder is the ordered sequence of
// exposure stages a release climbs after it passes preview-environment and
// automated tests: internal users first, then a small slice of production
// traffic, widening only while the automated analysis keeps returning promote.
//
// The schemas exist to make an unsafe ladder unrepresentable at the trust
// boundary (config file, env, deployment controller payload) rather than
// discovering it mid-rollout:
//   - a ladder starts at 0 percent internal-only, because deploy is not release
//   - exposure strictly ascends, because a climb may never narrow
//   - a ladder ends at 100 percent, because a rollout must be able to finish
//
// Schema-first: RolloutStage and RolloutLadder derive via z.infer; no shape is
// hand-written anywhere. DEFAULT_ROLLOUT_LADDER is the canonical ladder, but the
// stages stay configurable — a 5 then 25 climb is equally valid.
//
// Each refine reaches its stage through an optional chain. Zod runs .min(1) and
// every .refine over the same parsed array, so a refine still sees [] under
// noUncheckedIndexedAccess; the chains are load-bearing, not ceremony, and a
// missing stage fails the refine rather than throwing on undefined.
import { z } from 'zod';

export const RolloutStageSchema = z
  .object({
    id: z.string().min(1),
    exposurePercent: z.number().int().min(0).max(100),
    internalOnly: z.boolean(),
  })
  .strict();

export type RolloutStage = z.infer<typeof RolloutStageSchema>;

export const RolloutLadderSchema = z
  .array(RolloutStageSchema)
  .min(1)
  .refine(
    (stages) => {
      const first = stages[0];
      if (first === undefined) return false;
      return first.exposurePercent === 0 && first.internalOnly;
    },
    { message: 'a ladder must start at 0 percent, internal-only: deploy is not release' },
  )
  .refine(
    (stages) =>
      stages.every(
        (stage, i) => i === 0 || stage.exposurePercent > (stages[i - 1]?.exposurePercent ?? Infinity),
      ),
    { message: 'exposure must strictly ascend: a ladder may never narrow or repeat mid-climb' },
  )
  .refine((stages) => stages[stages.length - 1]?.exposurePercent === 100, {
    message: 'a ladder must end at 100 percent so the rollout can finish',
  });

export type RolloutLadder = z.infer<typeof RolloutLadderSchema>;

export const DEFAULT_ROLLOUT_LADDER: RolloutLadder = Object.freeze([
  Object.freeze({ id: 'internal', exposurePercent: 0, internalOnly: true }),
  Object.freeze({ id: 'canary_1', exposurePercent: 1, internalOnly: false }),
  Object.freeze({ id: 'ramp_10', exposurePercent: 10, internalOnly: false }),
  Object.freeze({ id: 'ramp_50', exposurePercent: 50, internalOnly: false }),
  Object.freeze({ id: 'full', exposurePercent: 100, internalOnly: false }),
]) as RolloutLadder;
