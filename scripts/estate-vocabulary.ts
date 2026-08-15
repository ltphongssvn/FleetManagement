// scripts/estate-vocabulary.ts
// THE LEAF. Every closed vocabulary this task shares, and nothing else.
//
// WHY THIS FILE EXISTS. estate-verify.ts imported estate-action.ts for the
// action schema, and estate-action.ts imported estate-verify.ts back for
// REASON_KIND -- a CYCLE. estate-reasons-across.ts formed a second one the same
// way. Both typechecked and both ran, which is exactly what makes the shape
// dangerous: ESM resolves the graph statically, evaluates children before
// parents, and throws only when a module-scope binding is read before its
// defining module finished evaluating.
//
// That read is present here, not hypothetical. EventBaseShape is a top-level
// const in estate-verify.ts that reads EstateActionSchema out of the cycle. It
// works today because of the order these files happen to load, and 2026
// guidance is blunt about what that means: the failure "appears or disappears
// based on load order, which changes when any import is added anywhere in the
// graph". A bug that passes every toolchain check and then trips on an
// unrelated import is not a bug worth keeping.
//
// The documented fix is a THIRD module both sides import from -- neutral
// ground. This file imports nothing but zod, so it can never be part of a
// cycle, and the guard test asserts that property rather than trusting it.
//
// Only the SHARED vocabulary moved. Behaviour stays where it was: classify,
// decide, describe and the event constructors remain in estate-verify.ts, and
// the action policy remains in estate-action.ts. Moving code that is not shared
// would be rearranging rather than fixing.
import { z } from 'zod';

/** Why one worktree is not clean. Codes, never prose: callers branch on these
 *  and the operator report is derived from them. */
export const ESTATE_REASONS = Object.freeze([
  'dirty',
  'unpushed',
  'stash',
  'prunable',
  'locked',
] as const);
export type EstateReason = (typeof ESTATE_REASONS)[number];

/** The kind vocabulary. FROZEN as well as as-const: `as const` is a COMPILE-
 *  time guarantee only, so an exported array stays mutable at runtime. One
 *  declaration serves the type, the ordering and the runtime schema. */
export const REASON_KINDS = Object.freeze(['work-in-progress', 'structural'] as const);
export type ReasonKind = (typeof REASON_KINDS)[number];

/** What KIND of problem a reason is, because the two kinds have different
 *  owners and different remediations.
 *
 *  work-in-progress -- dirty, unpushed, stash. The operator has work in flight
 *  and the fix is to finish it: commit, push, pop. No tool should act on these,
 *  and worktree:close already refuses on every one of them.
 *
 *  structural -- prunable, locked. The worktree itself is defective or
 *  deliberately held: prunable means the gitdir points nowhere and
 *  `git worktree prune` repairs it, while locked means someone locked it on
 *  purpose and unlocking needs their reason, not a sweep.
 *
 *  A TOTAL Record, so adding a reason without classifying it is a compile
 *  error -- the discipline check-conclusion.ts uses for its verdict table. */
export const REASON_KIND: Readonly<Record<EstateReason, ReasonKind>> = Object.freeze({
  dirty: 'work-in-progress',
  unpushed: 'work-in-progress',
  stash: 'work-in-progress',
  prunable: 'structural',
  locked: 'structural',
});

/** One unclean worktree, as reported. Cross-boundary: it is emitted inside
 *  body.problems and parsed by agents, so the SCHEMA is the SSOT and the type
 *  derives from it.
 *
 *  .readonly() so the inferred arrays match how the core builds them; without
 *  it z.infer yields a mutable array and a readonly source will not assign. */
export const EstateProblemSchema = z.strictObject({
  path: z.string(),
  branch: z.string(),
  reasons: z.array(z.enum(ESTATE_REASONS)).readonly(),
}).readonly();
export type EstateProblem = z.infer<typeof EstateProblemSchema>;

/** The kinds present across an estate, in declaration order and de-duplicated,
 *  so a consumer branches on TWO values rather than learning five reasons. */
export function kindsFor(reasons: readonly EstateReason[]): readonly ReasonKind[] {
  const seen = new Set(reasons.map((r) => REASON_KIND[r]));
  return REASON_KINDS.filter((k) => seen.has(k));
}

/** Every reason present anywhere in the estate, de-duplicated, in DECLARATION
 *  order -- never discovery order, so a consumer diffing two runs does not see
 *  a change because git happened to walk the estate differently. */
export function reasonsAcross(
  problems: readonly EstateProblem[],
): readonly EstateReason[] {
  const seen = new Set<EstateReason>();
  for (const p of problems) {
    for (const r of p.reasons) seen.add(r);
  }
  return ESTATE_REASONS.filter((r) => seen.has(r));
}
