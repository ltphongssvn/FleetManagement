// scripts/estate-policy.ts
// THE POLICY, AS ONE VERSIONED, DIGESTIBLE VALUE.
//
// WHAT WAS WRONG. The policy was real but no artifact WAS it. It lived in four
// places: REASON_KIND said which reasons are structural, actionForReasons said
// structural dominates, ACTION_EXIT said what each action exits with, and an
// if-chain inside reasonsFor decided which reasons a worktree raises at all.
// Each was individually defensible and collectively unauditable -- 2026
// agent-governance work names the failure exactly: "whether the agent did the
// right thing is not auditable, only inferable from logs of what happened",
// because enforcement lives in "application code wrapping each call in an
// if-check" rather than in a policy a reader can point at.
//
// THE SHARP CONSEQUENCE. ESTATE_SCHEMA_VERSION versions the EVENT, not the
// POLICY. Move `locked` from structural to work-in-progress tomorrow and every
// emitted event stays byte-identical in SHAPE while meaning something
// different. source_digest versus estate_digest already separates "the estate
// moved" from "the parser changed"; policy_digest is the third axis.
//
// WHAT THIS DELIBERATELY IS NOT. Not OPA, not Rego, not Cedar. Those are right
// when a tool catalogue crosses fifty entries. This has FIVE reasons and TWO
// kinds, and Rego in CLI mode measures 50-200ms per call for a process that
// runs in single-digit milliseconds.
//
// THE READING FIELDS ARE A VOCABULARY, not bare strings, so the projection from
// WorktreeState is total and checked rather than cast.
//
// ---- SUPPRESSION, AND THE DEADLOCK IT RESOLVES (2026-08-18) ----
//
// estate-verify-push refused a push because the worktree BEING PUSHED reported
// `unpushed`. Pushing is the only cure for unpushed, so the gate was
// structurally unsatisfiable for the branch it guards: commit, and the gate
// blocks; push, and the gate blocks first. Worse, the reasons are estate-wide,
// so ANY worktree holding an unpushed commit blocked every OTHER worktree's
// push too -- six terminals mutually deadlocked by design.
//
// The reason it took a live failure to see: the gate passes whenever the estate
// happens to be fully pushed, which is exactly the moment nobody is trying to
// push anything. An earlier read of this same hook concluded "no deadlock" for
// precisely that reason.
//
// THE FIX IS NOT A SPECIAL CASE IN THE HOOK. `unpushed` is a genuine defect at
// SESSION CLOSE -- work in flight nobody shipped -- and a non-defect at
// PRE-PUSH, where it names the operation in progress. That is a difference in
// POLICY, not in mechanism, and this module exists so a difference in policy is
// a difference in DATA. suppressed_reasons states it, and because the digest
// covers it, an event emitted under the push policy is distinguishable from one
// emitted under the default: a consumer can see WHICH rules produced PROCEED
// rather than having to trust that the right ones ran.
//
// The alternative -- excluding only the CURRENT worktree from the unpushed
// check -- was rejected. It needs the hook to know which directory it runs in
// and leaves sibling worktrees blocking each other for a state that is normal
// in a six-terminal estate. Suppression is one rule; the exclusion is a rule
// plus an identity check plus a remaining deadlock.
//
// EVERY OTHER REASON STILL BLOCKS A PUSH. dirty, stash, prunable and locked are
// unchanged under PUSH_POLICY: pushing does not resolve any of them.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ESTATE_REASONS,
  REASON_KINDS,
  type EstateReason,
  type ReasonKind,
} from './estate-vocabulary.js';

/** SEMVER, and independent of the event's version. The two move for different
 *  reasons: the event version changes when the PAYLOAD shape changes, this one
 *  when the RULES change.
 *
 *  2.0.0: suppressed_reasons is a new REQUIRED field, so a consumer pinned to
 *  1.0.0 would meet a key its contract does not declare -- and, worse, would
 *  read a PROCEED without knowing a reason had been suppressed to produce it.
 *  That is exactly "anything an existing reader could misinterpret". */
export const ESTATE_POLICY_VERSION = '2.0.0';

/** The fields of a worktree reading a policy may consult. A CLOSED vocabulary,
 *  because an open one costs the type system its grip.
 *
 *  Deliberately EXCLUDES path and branch. They identify a worktree; they never
 *  determine whether it is clean, and a policy that could read them could make
 *  a verdict depend on a name. */
export const READING_FIELDS = Object.freeze([
  'dirtyFileCount',
  'aheadOfRemote',
  'stashCount',
  'prunable',
  'locked',
] as const);
export type ReadingField = (typeof READING_FIELDS)[number];

/** One worktree's readings as the policy sees them: exactly the fields above.
 *  WorktreeState supplies every one, so the projection needs no assertion. */
export type PolicyReadings = Readonly<Record<ReadingField, number | boolean>>;

/** The policy itself. ONE value, frozen, digestible, versioned. */
export const EstatePolicySchema = z.strictObject({
  policy_version: z.literal(ESTATE_POLICY_VERSION),
  /** Which KIND each reason belongs to. TOTAL over the vocabulary. */
  reason_kind: z.record(z.enum(ESTATE_REASONS), z.enum(REASON_KINDS)),
  /** Which reading field raises each reason. TOTAL, and constrained to the
   *  named fields so a typo is a PARSE failure rather than a reason that
   *  silently never fires. */
  reason_trigger: z.record(z.enum(ESTATE_REASONS), z.enum(READING_FIELDS)),
  /** Reasons this policy does NOT treat as defects.
   *
   *  Not a hole in the vocabulary: the reason is still classified and still
   *  triggered, so a policy cannot suppress something it never declared. It is
   *  a statement about THIS decision point -- at pre-push, `unpushed` names the
   *  operation being performed, not a problem with it.
   *
   *  Empty by default, because suppressing a defect must be a deliberate,
   *  digested choice rather than an inherited one. */
  suppressed_reasons: z.array(z.enum(ESTATE_REASONS)).readonly(),
  /** STRUCTURAL DOMINATES. A worktree that is both dirty and prunable needs the
   *  repair first: finishing work inside a worktree whose gitdir points nowhere
   *  is not possible. Stated as ORDERED DATA so the precedence is auditable
   *  rather than buried in a ternary. */
  kind_precedence: z.array(z.enum(REASON_KINDS)).readonly(),
});
export type EstatePolicy = z.infer<typeof EstatePolicySchema>;

const BASE_RULES = {
  policy_version: ESTATE_POLICY_VERSION,
  reason_kind: {
    dirty: 'work-in-progress',
    unpushed: 'work-in-progress',
    stash: 'work-in-progress',
    prunable: 'structural',
    locked: 'structural',
  },
  reason_trigger: {
    dirty: 'dirtyFileCount',
    unpushed: 'aheadOfRemote',
    stash: 'stashCount',
    prunable: 'prunable',
    locked: 'locked',
  },
  // Most severe FIRST: the first kind present decides the halt.
  kind_precedence: ['structural', 'work-in-progress'],
} as const;

/** THE DEFAULT: every declared reason is a defect. Session close, sweeps, and
 *  any caller that does not say otherwise. */
export const ESTATE_POLICY: EstatePolicy = Object.freeze(
  EstatePolicySchema.parse({ ...BASE_RULES, suppressed_reasons: [] }),
);

/** THE PRE-PUSH VARIANT: identical except that `unpushed` is not a defect.
 *
 *  A push exists to make commits pushed, so refusing it because commits are
 *  unpushed is a gate that can never be satisfied by the operation it gates --
 *  and across six worktrees, one unpushed commit anywhere blocked everyone.
 *
 *  ONLY `unpushed`. dirty, stash, prunable and locked still block, because
 *  pushing resolves none of them: a dirty tree stays dirty, a stash stays
 *  stashed, and a prunable gitdir stays broken after the push succeeds. */
export const PUSH_POLICY: EstatePolicy = Object.freeze(
  EstatePolicySchema.parse({ ...BASE_RULES, suppressed_reasons: ['unpushed'] }),
);

/** The content address of a policy, so an event can name the exact rules that
 *  produced its recommendation.
 *
 *  CANONICALISED before hashing: fixed field order, fixed separators, reasons
 *  walked in DECLARATION order -- never JSON.stringify, whose key order follows
 *  insertion and would make the digest depend on how the literal was written.
 *
 *  suppressed_reasons is INSIDE the digest, which is the whole point of putting
 *  the suppression in the policy: a PROCEED reached by suppressing a reason is
 *  distinguishable, in the event stream, from a PROCEED reached because nothing
 *  was wrong. */
export function policyDigestOf(policy: EstatePolicy): string {
  const lines = [
    'policy_version=' + policy.policy_version,
    'kind_precedence=' + policy.kind_precedence.join(','),
    'suppressed=' + ESTATE_REASONS.filter((r) => policy.suppressed_reasons.includes(r)).join(','),
    ...ESTATE_REASONS.map(
      (r) => 'reason=' + r
        + ';kind=' + policy.reason_kind[r]
        + ';trigger=' + policy.reason_trigger[r],
    ),
  ];
  return createHash('sha256').update(lines.join('\u0001')).digest('hex');
}

/** Which reasons a set of observed readings raises, UNDER A GIVEN POLICY.
 *
 *  A boolean field is raised when true; a numeric one when above zero -- the
 *  SAME rule, "the reading is non-default", stated once so a new reason is a
 *  table entry rather than a branch.
 *
 *  A SUPPRESSED reason is filtered here, at the point a reason is RAISED, not
 *  later when an action is chosen. That keeps the suppression visible in the
 *  emitted attributes.reasons rather than only in the verdict: a consumer sees
 *  the estate as the policy sees it, and the policy digest says which policy
 *  that was.
 *
 *  DECLARATION order, never walk order -- a consumer diffing two runs must not
 *  see a change because the estate was enumerated differently. */
export function reasonsUnder(
  readings: PolicyReadings,
  policy: EstatePolicy = ESTATE_POLICY,
): readonly EstateReason[] {
  return ESTATE_REASONS.filter((reason) => {
    if (policy.suppressed_reasons.includes(reason)) return false;
    const value = readings[policy.reason_trigger[reason]];
    return typeof value === 'boolean' ? value : value > 0;
  });
}

/** The kinds present, in the policy's PRECEDENCE order rather than declaration
 *  order, so the first entry is the one that decides the halt. */
export function kindsUnder(
  reasons: readonly EstateReason[],
  policy: EstatePolicy = ESTATE_POLICY,
): readonly ReasonKind[] {
  const seen = new Set(reasons.map((r) => policy.reason_kind[r]));
  return policy.kind_precedence.filter((k) => seen.has(k));
}

/** Which halt a set of reasons warrants UNDER A GIVEN POLICY.
 *
 *  The precedence list decides, so "structural dominates" is a data fact a
 *  reader can check against the policy digest rather than a ternary buried in a
 *  function. Reordering kind_precedence changes the verdict AND the digest. */
export function actionUnder(
  reasons: readonly EstateReason[],
  policy: EstatePolicy = ESTATE_POLICY,
): 'PROCEED' | 'HALT_STRUCTURAL' | 'HALT_WORK_IN_PROGRESS' {
  if (reasons.length === 0) return 'PROCEED';
  const [most] = kindsUnder(reasons, policy);
  return most === 'structural' ? 'HALT_STRUCTURAL' : 'HALT_WORK_IN_PROGRESS';
}
