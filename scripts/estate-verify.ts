// scripts/estate-verify.ts
// Pure core: decide whether the worktree estate is CLEAN, and say why when it
// is not.
//
// WHY THIS EXISTS. Verifying the estate was three commands read by human eyes
// -- `git worktree list`, `git stash list`, `git status --porcelain` -- the
// shape worktree:close describes retiring: "a hand-rolled git idiom, not a
// captured op". It also nearly shipped a false report: the SWEEP's `unmerged`
// refusal, not those three commands, is what revealed PR #565 was still OPEN
// after it had been summarised as deployed.
//
// FOUR PROPERTIES, not three. `git worktree list --porcelain` also reports
// `prunable` ("gitdir file points to non-existent location") and `locked`. A
// stale worktree is a real defect -- GitLab records that "git 2.16 will fail
// badly if there are stale worktrees" -- and the hand check could not see one.
//
// EVENT IN, DECISION OUT. decideEstate consumes a versioned EstateObservation
// whose digest and states were derived atomically from the same porcelain by
// the authorized constructor in estate-gather, so the evidence a verdict names
// cannot have come from somewhere other than the estate it describes.
//
// AND THE RULES ARE A VALUE, NOT CONTROL FLOW. reasonsFor was an if-chain, so
// the question "which readings raise which reason" was answerable only by
// reading this function -- while REASON_KIND, the structural-dominates ternary
// and ACTION_EXIT each held another fragment. The policy was real and no
// artifact WAS it. It now lives in estate-policy.ts as one frozen, versioned,
// digestible value, and every emitted event carries policy_digest beside
// estate_digest and source_digest. That is the third axis of the same
// discrimination: source_digest separates "the estate moved" from "the parser
// changed", and policy_digest separates both from "the RULES changed".
//
// THE DOMAIN PRIMITIVES LIVE IN estate-events.ts, demoted there because the
// observation event carries WorktreeState and leaving it here would have closed
// a cycle. They are re-exported below, so every consumer resolves them
// unchanged; only the declaration moved.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { EstateActionSchema, exitCodeFor } from './estate-action.js';
import {
  ESTATE_POLICY,
  actionUnder,
  policyDigestOf,
  reasonsUnder,
  type EstatePolicy,
} from './estate-policy.js';
import {
  ALL_ZERO,
  DigestSchema,
  ESTATE_PRODUCER,
  ESTATE_SCHEMA_VERSION,
  SpanIdSchema,
  TimestampSchema,
  TraceIdSchema,
  UNOBSERVABLE_REASONS,
  WorktreeStateSchema,
  digestOf,
  observedFixture,
  unobservableFixture,
  type Digest,
  type EstateObservation,
  type EstateSchemaVersion,
  type SpanId,
  type Timestamp,
  type TraceId,
  type UnobservableReason,
  type WorktreeState,
} from './estate-events.js';
import {
  ESTATE_REASONS,
  EstateProblemSchema,
  REASON_KIND,
  REASON_KINDS,
  kindsFor,
  reasonsAcross,
  type EstateProblem,
  type EstateReason,
  type ReasonKind,
} from './estate-vocabulary.js';

// RE-EXPORTED, not re-declared. The vocabulary lives in one leaf, the shared
// kernel in another and the policy in a third, so every module reads them
// without importing each other; existing consumers resolve these names here.
export {
  ESTATE_REASONS,
  EstateProblemSchema,
  REASON_KIND,
  REASON_KINDS,
  kindsFor,
  reasonsAcross,
  type EstateProblem,
  type EstateReason,
  type ReasonKind,
};
export {
  DigestSchema,
  ESTATE_PRODUCER,
  ESTATE_SCHEMA_VERSION,
  SpanIdSchema,
  TimestampSchema,
  TraceIdSchema,
  UNOBSERVABLE_REASONS,
  WorktreeStateSchema,
  digestOf,
  observedFixture,
  unobservableFixture,
  type Digest,
  type EstateObservation,
  type EstateSchemaVersion,
  type SpanId,
  type Timestamp,
  type TraceId,
  type UnobservableReason,
  type WorktreeState,
};
export {
  ESTATE_POLICY,
  actionUnder,
  policyDigestOf,
  reasonsUnder,
  type EstatePolicy,
};

/** A DISCRIMINATED verdict, so an invalid combination cannot be built.
 *
 *  The previous shape was { clean: boolean; checked; problems }, which admits
 *  `clean: true` alongside a non-empty problems array -- a state the type
 *  system permitted and nothing in the domain could ever mean. */
export type EstateVerdict =
  | {
      readonly clean: true;
      readonly checked: number;
      readonly problems: readonly [];
    }
  | {
      readonly clean: false;
      readonly checked: number;
      readonly problems: readonly [EstateProblem, ...EstateProblem[]];
    };

/** Test-fixture factory. Overrides are applied BEFORE parsing, so an override
 *  that violates the contract throws instead of producing a state no git output
 *  could ever yield. */
export function createWorktreeState(
  overrides: Partial<WorktreeState> = {},
): WorktreeState {
  return WorktreeStateSchema.parse({
    path: '/c/t1-wt1-fixture',
    branch: 'feat/fixture',
    dirtyFileCount: 0,
    aheadOfRemote: 0,
    stashCount: 0,
    prunable: false,
    locked: false,
    ...overrides,
  });
}

/** Every reason at once, in a stable order, UNDER A POLICY.
 *
 *  This was an if-chain: five branches, each naming a field and a reason. That
 *  put the rule in CONTROL FLOW, where a sixth reason nobody wired would simply
 *  never be raised -- and a suite enumerating 2^N combinations would go on
 *  reporting full coverage of a space it had stopped covering. The mapping is
 *  now a total Record in the policy, so an unclassified reason is a COMPILE
 *  error, and this function is the projection rather than the rule. */
export function reasonsFor(
  state: WorktreeState,
  policy: EstatePolicy = ESTATE_POLICY,
): readonly EstateReason[] {
  return reasonsUnder(state, policy);
}

/** Pure verdict over the whole estate. An EMPTY estate is clean, not an error:
 *  a fresh clone with no linked worktrees is a legitimate state. The OBSERVER,
 *  not this function, fails closed when git cannot be read at all. */
export function classifyEstate(
  states: readonly WorktreeState[],
  policy: EstatePolicy = ESTATE_POLICY,
): EstateVerdict {
  const problems: EstateProblem[] = [];
  for (const s of states) {
    const reasons = reasonsFor(s, policy);
    if (reasons.length > 0) {
      problems.push({ path: s.path, branch: s.branch, reasons });
    }
  }
  // SORTED BY PATH, matching estateDigest's normalisation. The loop walks
  // states in git's listing order, so an unchanged estate could otherwise yield
  // the same estate_digest with a differently-ordered body.problems, and a
  // consumer diffing two events would see a change that never happened.
  problems.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Destructured, never cast: `first` proves the array is non-empty to the
  // compiler, so the dirty arm is constructed without asserting anything.
  const [first, ...rest] = problems;
  return first === undefined
    ? { clean: true, checked: states.length, problems: [] }
    : { clean: false, checked: states.length, problems: [first, ...rest] };
}

/** Operator report. Names the worktree AND every reason, and on success states
 *  HOW MANY were checked -- a bare "OK" cannot be told apart from a run that
 *  examined nothing, which is the confident-zero hazard. */
export function describeEstate(v: EstateVerdict): string {
  const nl = String.fromCharCode(10);
  if (v.clean) {
    return 'estate clean: ' + String(v.checked) + ' worktree(s) checked, ' +
      'no dirty tree, no unpushed commits, no stash, none stale or locked';
  }
  const lines = v.problems.map(
    (p) => '  ' + p.path + ' [' + p.branch + '] (' + p.reasons.join(',') + ')',
  );
  return 'estate NOT clean: ' + String(v.problems.length) + ' of ' +
    String(v.checked) + ' worktree(s)' + nl + lines.join(nl);
}

/** Machine-readable verdict. STRUCTURED TRUTH, emitted alongside the prose and
 *  DERIVED FROM THE SAME VERDICT -- never parsed back out of the sentence.
 *
 *  OpenTelemetry Events shape: event.name is NAMESPACED and identifies the
 *  payload STRUCTURE. ATTRIBUTES hold only queryable scalars; the unbounded
 *  per-worktree detail lives in BODY, because backends do not index inside
 *  complex attributes. */
export function estateTelemetry(
  v: EstateVerdict,
  trace: SpanContext | null = null,
  // REQUIRED, no default. A verdict is always ABOUT a specific snapshot, and
  // the recommendation this event carries is derived from that snapshot alone.
  digest: Digest,
  // The instant, INJECTED. An audit record needs a timestamp, and a pure core
  // must not read a clock -- so the shell supplies it and a test pins it.
  timestamp: Timestamp,
  sourceDigest: Digest | null = null,
  policy: EstatePolicy = ESTATE_POLICY,
): EstateTelemetry {
  const reasons = reasonsAcross(v.problems);
  return {
    "event.name": "fleet.estate.verified",
    schema_version: ESTATE_SCHEMA_VERSION,
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: actionUnder(reasons, policy),
    ...severityFor(v),
    ...(trace ?? {}),
    estate_digest: digest,
    // WHICH RULES produced the recommendation above. Without it a consumer
    // diffing two runs cannot tell a changed estate from a changed policy, and
    // agent_action is advice whose derivation nobody downstream can re-check.
    policy_digest: policyDigestOf(policy),
    ...(sourceDigest === null ? {} : { source_digest: sourceDigest }),
    attributes: {
      clean: v.clean,
      checked: v.checked,
      unclean_count: v.problems.length,
      reasons,
      kinds: kindsFor(reasons),
    },
    body: { problems: v.problems },
  };
}

/** Parse one raw record into a WorktreeState, or null.
 *
 *  safeParse, NEVER parse. A record git produced that the schema rejects would
 *  otherwise throw an uncaught ZodError, and the contract is EXACTLY ONE NDJSON
 *  event on stdout -- an uncaught throw emits a stack trace and NO event. */
export function toWorktreeState(raw: unknown): WorktreeState | null {
  const parsed = WorktreeStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The severity vocabulary. Numbers follow the OTel ranges -- INFO 9, WARN 13,
 *  ERROR 17 -- which are part of the Logs Data Model precisely so severity is
 *  not re-derived from payload fields by every consumer. */
export const SEVERITY_TEXTS = Object.freeze(['INFO', 'WARN', 'ERROR'] as const);
export const SEVERITY_NUMBERS = Object.freeze([9, 13, 17] as const);

export const EstateSeveritySchema = z.strictObject({
  severity_text: z.enum(SEVERITY_TEXTS),
  severity_number: z.literal(SEVERITY_NUMBERS),
});
export type EstateSeverity = z.infer<typeof EstateSeveritySchema>;

export function severityFor(v: EstateVerdict, readable = true): EstateSeverity {
  // Unreadable outranks unclean: a verdict we could not compute is a tooling
  // failure, while a dirty worktree is a normal working state.
  if (readable) {
    return v.clean
      ? { severity_text: "INFO", severity_number: 9 }
      : { severity_text: "WARN", severity_number: 13 };
  }
  return { severity_text: "ERROR", severity_number: 17 };
}

/** W3C trace context, INHERITED not invented. A trace_id this process generates
 *  for itself correlates nothing -- one run, one event. Returns null when
 *  absent or malformed rather than fabricating an id: a fabricated correlation
 *  id looks like provenance and carries none. */
export const TraceContextSchema = z.strictObject({
  trace_id: TraceIdSchema,
  span_id: SpanIdSchema,
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

export const SpanContextSchema = TraceContextSchema.extend({
  parent_span_id: SpanIdSchema.optional(),
});
export type SpanContext = z.infer<typeof SpanContextSchema>;

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function traceContextFrom(raw: string | undefined): TraceContext | null {
  if (raw === undefined) return null;
  const m = TRACEPARENT.exec(raw.trim());
  if (m === null) return null;
  const [, traceId, spanId] = m;
  // PARSED, not hand-checked: the all-zero rule lives in ONE place rather than
  // being re-tested at each call site.
  const parsed = TraceContextSchema.safeParse({ trace_id: traceId, span_id: spanId });
  return parsed.success ? parsed.data : null;
}

/** Content-addressable digest of the estate SNAPSHOT.
 *
 *  DETERMINISM IS THE WHOLE VALUE, so the input is normalised before hashing:
 *  entries sorted by path, each serialised with a FIXED field order rather than
 *  JSON.stringify, whose key order follows insertion.
 *
 *  NOT SIGNED, deliberately. A local tool signing with a key it holds proves
 *  nothing: signer and verifier are the same principal. */
export function estateDigest(states: readonly WorktreeState[]): Digest {
  const lines = [...states]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((s) => [
      s.path, s.branch, String(s.dirtyFileCount), String(s.aheadOfRemote),
      String(s.stashCount), String(s.prunable), String(s.locked),
    ].join('\u0000'));
  return digestOf(lines.join("\u0001"));
}

/** Why the estate could not be read. The EMITTED vocabulary, a superset of the
 *  observation's: 'threw' names OUR OWN defect, which only the run envelope can
 *  detect, and collapsing it into git-failed would let a bug hide behind an
 *  operational excuse. */
export const UNREADABLE_REASONS = Object.freeze([
  'git-failed',
  'no-records',
  'record-rejected',
  'threw',
] as const);
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

export type EstateEvent =
  | EstateTelemetry
  | EstateUnreadableEvent
  | EstateStaleEvent;

export function unreadableEstateEvent(
  reason: UnreadableReason,
  timestamp: Timestamp,
  trace: SpanContext | null = null,
  sourceDigest: Digest | null = null,
  policy: EstatePolicy = ESTATE_POLICY,
): EstateUnreadableEvent {
  return {
    'event.name': 'fleet.estate.unreadable',
    schema_version: ESTATE_SCHEMA_VERSION,
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: 'REPAIR_TOOLING',
    severity_text: 'ERROR',
    severity_number: 17,
    ...(trace ?? {}),
    // Carried even here: REPAIR_TOOLING is itself a recommendation, and a
    // consumer auditing why it was told to repair needs the same provenance a
    // verdict carries. Omitting it would make the unreadable path the one place
    // advice arrives unattributed.
    policy_digest: policyDigestOf(policy),
    ...(sourceDigest === null ? {} : { source_digest: sourceDigest }),
    attributes: { reason },
  };
}

/** A DISCRIMINATED decision, so a verdict exists exactly when there is one.
 *
 *  exitCode is narrowed PER VARIANT, so 3 belongs to unreadable and 4 to stale
 *  by construction. It is retained deliberately: the agentic-loop rule forbids
 *  a decision crossing a boundary as an ANONYMOUS result object, and the
 *  payload here IS the versioned event. Deriving the exit code in the shell
 *  would be a SECOND implementation of what exitCodeFor already owns. */
export type EstateDecision =
  | {
      readonly kind: 'unreadable';
      readonly event: EstateUnreadableEvent;
      readonly exitCode: 3;
    }
  | {
      readonly kind: 'stale';
      readonly event: EstateStaleEvent;
      readonly exitCode: 4;
    }
  | {
      readonly kind: 'verified';
      readonly event: EstateTelemetry;
      readonly verdict: EstateVerdict;
      readonly exitCode: 0 | 1;
    };

function unreachable(x: never): never {
  throw new Error('unhandled observation: ' + JSON.stringify(x));
}

/** EVENT IN, DECISION OUT. Pure: no git, no stdout, no clock.
 *
 *  The observation is a VERSIONED EVENT whose digest was derived from the same
 *  porcelain bytes as its states, so a verdict cannot name evidence that came
 *  from somewhere else. The POLICY is likewise a parameter with a frozen
 *  default: injectable so a simulation can reason counterfactually, recorded in
 *  the event so a caller-supplied one can never pass unnoticed. */
export function decideEstate(
  observation: EstateObservation,
  trace: SpanContext | null = null,
  expectDigest: Digest | null = null,
  timestamp: Timestamp = TimestampSchema.parse('1970-01-01T00:00:00.000Z'),
  policy: EstatePolicy = ESTATE_POLICY,
): EstateDecision {
  switch (observation['event.name']) {
    case 'fleet.estate.unobservable':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent(
          observation.reason,
          timestamp,
          trace,
          observation.source_digest ?? null,
          policy,
        ),
        exitCode: exitCodeFor('REPAIR_TOOLING'),
      };
    case 'fleet.estate.observed': {
      const actual = estateDigest(observation.states);
      // COMPARE-AND-SWAP, before any verdict: a caller that pinned a digest is
      // asking to act only on THAT estate, and reporting a verdict for a
      // different one is the lost update the check exists to prevent.
      if (expectDigest !== null && expectDigest !== actual) {
        return {
          kind: 'stale',
          event: estateStaleEvent(expectDigest, actual, timestamp, trace, policy),
          exitCode: exitCodeFor('REREAD_ESTATE'),
        };
      }
      const verdict = classifyEstate(observation.states, policy);
      return {
        kind: 'verified',
        event: estateTelemetry(
          verdict, trace, actual, timestamp, observation.source_digest, policy,
        ),
        exitCode: exitCodeFor(actionUnder(reasonsAcross(verdict.problems), policy)),
        verdict,
      };
    }
    default:
      return unreachable(observation);
  }
}

/** The estate moved between the read and the act. The If-Match / 412 shape,
 *  value-based rather than a version counter: the digest IS the content, so it
 *  cannot drift from what it describes. */
export function estateStaleEvent(
  expectedDigest: Digest,
  actualDigest: Digest,
  timestamp: Timestamp,
  trace: SpanContext | null = null,
  policy: EstatePolicy = ESTATE_POLICY,
): EstateStaleEvent {
  return {
    'event.name': 'fleet.estate.stale',
    schema_version: ESTATE_SCHEMA_VERSION,
    // WARN, not ERROR: nothing is broken. The caller's view is out of date,
    // which is normal in a concurrent estate and is recovered by re-reading.
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: 'REREAD_ESTATE',
    severity_text: 'WARN',
    severity_number: 13,
    ...(trace ?? {}),
    policy_digest: policyDigestOf(policy),
    attributes: { expected_digest: expectedDigest, estate_digest: actualDigest },
  };
}

/** RUNTIME schema for everything this task emits. Discriminated on event.name,
 *  so a parse failure names WHICH variant disagreed. strictObject throughout:
 *  an unrecognised key in an event WE construct is our own typo. */
const EventBaseShape = {
  schema_version: z.literal(ESTATE_SCHEMA_VERSION),
  timestamp: TimestampSchema,
  producer: z.literal(ESTATE_PRODUCER),
  trace_id: TraceContextSchema.shape.trace_id.optional(),
  span_id: TraceContextSchema.shape.span_id.optional(),
  // WHAT THE CALLER MAY DO. ADVISORY, NEVER AUTHORIZATION: no field a tool
  // emits is self-authorizing, and a consumer treating PROCEED as consent is
  // the confused-deputy failure. The policy decision point sits OUTSIDE this
  // tool; what the tool owes it is a recommendation bound to its evidence.
  agent_action: EstateActionSchema,
  // WHICH RULES produced that recommendation. REQUIRED on every variant: advice
  // whose derivation cannot be named is advice a downstream PDP cannot
  // re-check, and the unreadable path recommending REPAIR_TOOLING is advice
  // too. A plain sha256 hex string rather than a branded Digest, because the
  // brand exists to stop an ESTATE digest being confused with a source digest
  // and this is neither.
  policy_digest: z.string().regex(/^[0-9a-f]{64}$/),
  parent_span_id: SpanContextSchema.shape.parent_span_id,
} as const;

export const EstateTelemetrySchema = z.strictObject({
  'event.name': z.literal('fleet.estate.verified'),
  ...EventBaseShape,
  severity_text: EstateSeveritySchema.shape.severity_text,
  severity_number: EstateSeveritySchema.shape.severity_number,
  estate_digest: DigestSchema,
  source_digest: DigestSchema.optional(),
  attributes: z.strictObject({
    clean: z.boolean(),
    checked: z.number().int().nonnegative(),
    unclean_count: z.number().int().nonnegative(),
    reasons: z.array(z.enum(ESTATE_REASONS)).readonly(),
    kinds: z.array(z.enum(REASON_KINDS)).readonly(),
  }),
  body: z.strictObject({
    problems: z.array(EstateProblemSchema).readonly(),
  }),
});

export const EstateUnreadableEventSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.unreadable'),
  ...EventBaseShape,
  severity_text: z.literal('ERROR'),
  severity_number: z.literal(17),
  source_digest: DigestSchema.optional(),
  attributes: z.strictObject({ reason: z.enum(UNREADABLE_REASONS) }),
});

export const EstateStaleEventSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.stale'),
  ...EventBaseShape,
  severity_text: z.literal('WARN'),
  severity_number: z.literal(13),
  attributes: z.strictObject({
    expected_digest: DigestSchema,
    estate_digest: DigestSchema,
  }),
});

export const EstateEventSchema = z.discriminatedUnion('event.name', [
  EstateTelemetrySchema,
  EstateUnreadableEventSchema,
  EstateStaleEventSchema,
]);

export type EstateTelemetry = z.infer<typeof EstateTelemetrySchema>;
export type EstateUnreadableEvent = z.infer<typeof EstateUnreadableEventSchema>;
export type EstateStaleEvent = z.infer<typeof EstateStaleEventSchema>;

/** A span of our own, inside the caller's trace. W3C is explicit that a child
 *  generates a NEW span id and records the received one as its parent; copying
 *  it upward leaves a trace with a hole exactly where the work happened.
 *
 *  randomBytes, not Math.random: span ids must not collide across concurrent
 *  runs, and two laptops sweep the same estate simultaneously. */
export function newSpanId(rand: () => Buffer = () => randomBytes(8)): SpanId {
  const id = rand().toString('hex');
  return SpanIdSchema.parse(ALL_ZERO.test(id) ? '0'.repeat(15) + '1' : id);
}

export function spanContextFor(
  parent: TraceContext | null,
  newId: () => SpanId = newSpanId,
): SpanContext | null {
  if (parent === null) return null;
  return {
    trace_id: parent.trace_id,
    span_id: newId(),
    parent_span_id: parent.span_id,
  };
}
