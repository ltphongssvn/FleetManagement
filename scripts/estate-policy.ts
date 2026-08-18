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
// THE SHARP CONSEQUENCE, and the reason this is a defect rather than a tidiness
// complaint. ESTATE_SCHEMA_VERSION versions the EVENT, not the POLICY. Move
// `locked` from structural to work-in-progress tomorrow and every emitted event
// stays byte-identical in SHAPE while meaning something different -- so a
// consumer diffing two runs cannot tell a changed policy from a changed estate.
// This arc already built exactly that discrimination once: source_digest versus
// estate_digest separates "the estate moved" from "the parser changed".
// policy_digest is the third axis, and it was missing.
//
// WHAT THIS DELIBERATELY IS NOT. Not OPA, not Rego, not Cedar. Those are the
// right answer when a tool catalogue crosses fifty entries and conditions
// multiply across tenants, data classes and roles -- the scale the 2026 sources
// name. estate:verify has FIVE reasons and TWO kinds, and the Agent Governance
// Toolkit measures Rego in CLI mode at 50-200ms per call for a process that
// runs in single-digit milliseconds. A sidecar here would be the same shape of
// rigour without the substance that kept Kafka and an MCP server out of this
// arc.
//
// NOR IS IT "PLUGGABLE" IN THE DANGEROUS SENSE. The policy is INJECTABLE, which
// is what makes it testable and lets a simulation reason counterfactually --
// but the production default is frozen, and every event records the digest of
// the policy that produced it. A tool whose policy the CALLER supplies without
// that record is a tool with no policy, which is the confused-deputy failure
// this arc refuses everywhere else.
//
// THE READING FIELDS ARE A VOCABULARY, not bare strings. An earlier revision
// typed reason_trigger as z.string(), which forced the readings parameter to be
// an open Record<string, number|boolean> -- and WorktreeState does not satisfy
// that, because `path` is a string. The fix a cast would have hidden is the
// real one: NAME the fields a policy may read. The projection is then total and
// checked, WorktreeState provably supplies exactly those keys, and a policy
// naming a field that does not exist fails to parse rather than silently
// raising nothing.
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
 *  when the RULES change. Conflating them would mean either a policy change
 *  silently reusing an event version, or an event change forcing consumers to
 *  re-audit a policy that never moved. */
export const ESTATE_POLICY_VERSION = '1.0.0';

/** The fields of a worktree reading a policy may consult. A CLOSED vocabulary,
 *  because an open one costs the type system its grip: with z.string() here the
 *  readings had to be Record<string, ...>, which WorktreeState cannot satisfy,
 *  and the only way through would have been a cast that defeats the brand.
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

/** The policy itself. ONE value, frozen, digestible, versioned.
 *
 *  strictObject, so a policy carrying a key the contract does not declare is
 *  rejected rather than silently ignored -- the same argument every other
 *  boundary in this arc makes. */
export const EstatePolicySchema = z.strictObject({
  policy_version: z.literal(ESTATE_POLICY_VERSION),
  /** Which KIND each reason belongs to: work-in-progress is the operator's to
   *  finish, structural is a git repair. TOTAL over the vocabulary. */
  reason_kind: z.record(z.enum(ESTATE_REASONS), z.enum(REASON_KINDS)),
  /** Which reading field raises each reason. TOTAL over the vocabulary, and
   *  constrained to the named fields so a typo is a PARSE failure rather than a
   *  reason that silently never fires. */
  reason_trigger: z.record(z.enum(ESTATE_REASONS), z.enum(READING_FIELDS)),
  /** STRUCTURAL DOMINATES. A worktree that is both dirty and prunable needs the
   *  repair first: finishing work inside a worktree whose gitdir points nowhere
   *  is not possible, so reporting work-in-progress would send the operator to a
   *  remedy that cannot run. Stated as ORDERED DATA so the precedence is
   *  auditable rather than buried in a ternary -- and so reordering it changes
   *  the policy digest, which is the whole point. */
  kind_precedence: z.array(z.enum(REASON_KINDS)).readonly(),
});
export type EstatePolicy = z.infer<typeof EstatePolicySchema>;

export const ESTATE_POLICY: EstatePolicy = Object.freeze(
  EstatePolicySchema.parse({
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
  }),
);

/** The content address of a policy, so an event can name the exact rules that
 *  produced its recommendation.
 *
 *  CANONICALISED before hashing, exactly as estateDigest is: fixed field order,
 *  fixed separators, reasons walked in DECLARATION order -- never
 *  JSON.stringify over the object, whose key order follows insertion and would
 *  make the digest depend on how the literal was written. A digest that changes
 *  when nothing changed is worse than none: it reports a policy change that
 *  never happened. */
export function policyDigestOf(policy: EstatePolicy): string {
  const lines = [
    'policy_version=' + policy.policy_version,
    'kind_precedence=' + policy.kind_precedence.join(','),
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
 *  Takes readings rather than a WorktreeState so this module stays a leaf: it
 *  states rules over the vocabulary and never reaches up into the core's
 *  schemas. DECLARATION order, never walk order -- a consumer diffing two runs
 *  must not see a change because the estate was enumerated differently. */
export function reasonsUnder(
  readings: PolicyReadings,
  policy: EstatePolicy = ESTATE_POLICY,
): readonly EstateReason[] {
  return ESTATE_REASONS.filter((reason) => {
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
 *  function. Reordering kind_precedence changes the verdict AND the digest,
 *  which is precisely the auditability that was missing. */
export function actionUnder(
  reasons: readonly EstateReason[],
  policy: EstatePolicy = ESTATE_POLICY,
): 'PROCEED' | 'HALT_STRUCTURAL' | 'HALT_WORK_IN_PROGRESS' {
  if (reasons.length === 0) return 'PROCEED';
  const [most] = kindsUnder(reasons, policy);
  return most === 'structural' ? 'HALT_STRUCTURAL' : 'HALT_WORK_IN_PROGRESS';
}
