// packages/domain/src/delivery/rollout-stage.ts
// Progressive-delivery rollout ladder SSOT. A ladder is the ordered sequence of
// exposure stages a release climbs after it passes preview-environment and
// automated tests: internal users first, then a small slice of production
// traffic, widening only while the automated analysis keeps returning promote.
//
// A stage has no id. Argo Rollouts and Flagger both identify a stage by its
// position and its weight -- the controller reports Step: 1/8, SetWeight: 20, and
// analysis binds to a stage via startingStep, never by a name. A name field would
// force an impossible choice: a fixed vocabulary cannot cover an arbitrary weight
// (5, 25, 30, 37, 75...), and a free-form string re-runs the cancel-reason failure
// where a typo parses clean and adding a member fails to fail compilation.
// Deleting the field removes the choice: identity is index plus weight, and a typo
// is unrepresentable because there is no string to mistype. internalOnly carries
// the one distinction the rollout policy names, and it is a boolean, not a name.
//
// The schemas exist to make an unsafe ladder unrepresentable at the trust boundary
// (config file, env, deployment controller payload) rather than discovering it
// mid-rollout:
//   - a ladder starts at 0 percent internal-only, because deploy is not release
//   - exposure strictly ascends, because a climb may never narrow
//   - a ladder ends at 100 percent, because a rollout must be able to finish
//
// Schema-first: RolloutStage and RolloutLadder derive via z.infer; no shape is
// hand-written anywhere. DEFAULT_ROLLOUT_LADDER is the canonical ladder, but any
// ascending weights are expressible -- a 5 then 25 climb parses equally.
//
// The ascent check walks the array instead of indexing it. Indexing under
// noUncheckedIndexedAccess forces a nullish fallback runtime can never take
// (the previous stage is always present once the walk has begun), leaving a
// permanently uncovered branch that the 90 percent coverage gate rejects. A
// running previous value expresses the same invariant with no unreachable path.
// The first and last stages still need optional access: Zod runs .min(1) and every
// .refine over the same parsed array, so a refine does see [] -- that path is real
// and covered by the empty-ladder test.
import { z } from 'zod';

export const RolloutStageSchema = z
  .object({
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
    (stages) => {
      let previous = -1;
      for (const stage of stages) {
        if (stage.exposurePercent <= previous) return false;
        previous = stage.exposurePercent;
      }
      return true;
    },
    { message: 'exposure must strictly ascend: a ladder may never narrow or repeat mid-climb' },
  )
  .refine((stages) => stages[stages.length - 1]?.exposurePercent === 100, {
    message: 'a ladder must end at 100 percent so the rollout can finish',
  });

export type RolloutLadder = z.infer<typeof RolloutLadderSchema>;

export const DEFAULT_ROLLOUT_LADDER: RolloutLadder = Object.freeze([
  Object.freeze({ exposurePercent: 0, internalOnly: true }),
  Object.freeze({ exposurePercent: 1, internalOnly: false }),
  Object.freeze({ exposurePercent: 10, internalOnly: false }),
  Object.freeze({ exposurePercent: 50, internalOnly: false }),
  Object.freeze({ exposurePercent: 100, internalOnly: false }),
]) as RolloutLadder;
