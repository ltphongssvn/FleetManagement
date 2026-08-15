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
// EVENT IN, DECISION OUT. decideEstate consumed {kind:'states', states,
// sourceDigest} -- an internal shape with no event name, no schema version and
// no parse step, which the 2026 agentic-loop rule names as forbidden by
// example. It now consumes a versioned EstateObservation whose digest and
// states were derived atomically from the same porcelain by the authorized
// constructor in estate-gather. So the evidence a verdict names cannot have
// come from somewhere other than the estate it describes.
//
// THE DOMAIN PRIMITIVES LIVE IN estate-events.ts. WorktreeStateSchema was
// demoted there because the observation event carries it, and leaving it here
// while estate-gather imports this module would have closed a CYCLE the moment
// the decider began consuming observations. They are re-exported below, so
// every consumer that resolved them from here still does; only the declaration
// moved.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { EstateActionSchema, actionForVerdict, exitCodeFor } from './estate-action.js';
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

// RE-EXPORTED, not re-declared. The vocabulary lives in one leaf and the shared
// kernel in another, so this module and estate-action.ts can both read them
// without importing each other; every existing consumer still resolves these
// names from here.
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

/** A DISCRIMINATED verdict, so an invalid combination cannot be built.
 *
 *  The previous shape was { clean: boolean; checked; problems }, which admits
 *  `clean: true` alongside a non-empty problems array -- a state the type
 *  system permitted and nothing in the domain could ever mean. Splitting the
 *  variants and typing the dirty arm's problems as a NON-EMPTY tuple makes both
 *  contradictions unrepresentable rather than merely unlikely.
 *
 *  The event is deliberately NOT embedded here. It is DERIVED from this
 *  verdict, and storing a derivation beside its source admits a verdict whose
 *  event disagrees with its own fields. */
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
 *  could ever yield. Default is the CLEAN baseline, so each test overrides only
 *  the dimension it exercises. */
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

/** Every reason at once, in a stable order. A report that stops at the first
 *  problem sends the operator round the loop once per problem -- the sibling
 *  failure GitLab records, where a cleanup returned "only the error code ...
 *  which made it difficult to diagnose". */
export function reasonsFor(state: WorktreeState): readonly EstateReason[] {
  const reasons: EstateReason[] = [];
  if (state.dirtyFileCount > 0) reasons.push('dirty');
  if (state.aheadOfRemote > 0) reasons.push('unpushed');
  if (state.stashCount > 0) reasons.push('stash');
  if (state.prunable) reasons.push('prunable');
  if (state.locked) reasons.push('locked');
  return reasons;
}

/** Pure verdict over the whole estate. An EMPTY estate is clean, not an error:
 *  a fresh clone with no linked worktrees is a legitimate state. The OBSERVER,
 *  not this function, is responsible for failing closed when git cannot be read
 *  at all -- an unreadable estate must never reach here looking empty. */
export function classifyEstate(states: readonly WorktreeState[]): EstateVerdict {
  const problems: EstateProblem[] = [];
  for (const s of states) {
    const reasons = reasonsFor(s);
    if (reasons.length > 0) {
      problems.push({ path: s.path, branch: s.branch, reasons });
    }
  }
  // SORTED BY PATH, matching estateDigest's normalisation. The loop above walks
  // states in git's listing order, so an unchanged estate could yield the same
  // estate_digest (which sorts) while body.problems came out ordered
  // differently -- and a consumer diffing two events would see a change that
  // never happened.
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
 *  examined nothing, which is the confident-zero hazard stack:stop and
 *  docker:reclaim both guard. */
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
 *  OpenTelemetry Events shape: event.name is NAMESPACED and low-cardinality,
 *  and identifies the payload STRUCTURE. ATTRIBUTES hold only queryable
 *  scalars; the unbounded per-worktree detail lives in BODY, because backends
 *  do not index inside complex attributes. */
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
): EstateTelemetry {
  const reasons = reasonsAcross(v.problems);
  return {
    "event.name": "fleet.estate.verified",
    schema_version: ESTATE_SCHEMA_VERSION,
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: actionForVerdict(reasons),
    ...severityFor(v),
    ...(trace ?? {}),
    estate_digest: digest,
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
 *  event on stdout -- an uncaught throw emits a stack trace and NO event, so
 *  the fail-closed guarantee disappears in the one case it exists for.
 *
 *  Returns null rather than a partial state: a half-parsed worktree would be a
 *  guess, and guessing here means reporting a verdict about a worktree we could
 *  not actually read. */
export function toWorktreeState(raw: unknown): WorktreeState | null {
  const parsed = WorktreeStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The severity vocabulary, as const for the same reason REASON_KINDS is: one
 *  declaration serves the type and the runtime schema. Numbers follow the OTel
 *  ranges -- INFO 9, WARN 13, ERROR 17, which are part of the Logs Data Model
 *  precisely so severity is not re-derived from payload fields by every
 *  consumer. */
export const SEVERITY_TEXTS = Object.freeze(['INFO', 'WARN', 'ERROR'] as const);
export const SEVERITY_NUMBERS = Object.freeze([9, 13, 17] as const);

/** SCHEMA-FIRST. This was a hand-written interface paralleling the severity
 *  fields already declared in the event schemas -- one contract, three
 *  declarations, with a guard test existing only to prove they agreed. A test
 *  that exists to prove two declarations agree is the duplication itself. */
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

/** W3C trace context, INHERITED not invented.
 *
 *  A trace_id this process generates for itself correlates nothing -- one run,
 *  one event. It becomes useful only when a PARENT supplies it. Returns null
 *  when absent or malformed rather than fabricating an id: a fabricated
 *  correlation id looks like provenance and carries none.
 *
 *  The two ids are DERIVED from the branded schemas in the kernel, so there is
 *  one rule per id rather than a hand-rolled regex at each boundary. */
export const TraceContextSchema = z.strictObject({
  trace_id: TraceIdSchema,
  span_id: SpanIdSchema,
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

/** This run's span: a TraceContext plus the parent it descends from. */
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
  // PARSED, not hand-checked. The regex splits the header; the schema decides
  // whether the parts are a valid context, so the all-zero rule lives in ONE
  // place rather than being re-tested at each call site.
  const parsed = TraceContextSchema.safeParse({ trace_id: traceId, span_id: spanId });
  return parsed.success ? parsed.data : null;
}

/** Content-addressable digest of the estate SNAPSHOT.
 *
 *  Lets a consumer say "this is the state I acted on" and re-derive it later,
 *  and distinguishes an unchanged estate from one that changed and changed back
 *  -- which a timestamp cannot.
 *
 *  DETERMINISM IS THE WHOLE VALUE, so the input is normalised before hashing:
 *  entries sorted by path, each serialised with a FIXED field order rather than
 *  JSON.stringify, whose key order follows insertion and would make the digest
 *  depend on how the driver happened to build the literal.
 *
 *  NOT SIGNED, deliberately. A local tool signing with a key it holds proves
 *  nothing: signer and verifier are the same principal. Keyless signing needs
 *  an ambient OIDC identity that exists in CI and not on a laptop. */
export function estateDigest(states: readonly WorktreeState[]): Digest {
  const lines = [...states]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((s) => [
      s.path, s.branch, String(s.dirtyFileCount), String(s.aheadOfRemote),
      String(s.stashCount), String(s.prunable), String(s.locked),
    ].join('\u0000'));
  return digestOf(lines.join("\u0001"));
}

/** Why the estate could not be read. Codes, so a router acts without parsing
 *  prose. This is the EMITTED vocabulary, a superset of the observation's:
 *  'threw' names OUR OWN defect, which only the run envelope can detect. */
export const UNREADABLE_REASONS = Object.freeze([
  'git-failed',
  'no-records',
  'record-rejected',
  // NOT merged into git-failed: that names a subprocess that failed, an
  // expected condition with a known remedy, while this names a code defect.
  // Collapsing the two would let a bug hide behind an operational excuse.
  'threw',
] as const);
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

/** The closed set of events this task emits. event.name is the discriminant.
 *
 *  A DISTINCT event per shape, not one event with awkward values. Both variants
 *  once carried "fleet.estate.verified", so a consumer told them apart by
 *  inferring from `clean:false, checked:0` -- an invalid combination that reads
 *  exactly like "could not read". */
export type EstateEvent =
  | EstateTelemetry
  | EstateUnreadableEvent
  | EstateStaleEvent;

export function unreadableEstateEvent(
  reason: UnreadableReason,
  timestamp: Timestamp,
  trace: SpanContext | null = null,
  sourceDigest: Digest | null = null,
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
    ...(sourceDigest === null ? {} : { source_digest: sourceDigest }),
    attributes: { reason },
  };
}

/** A DISCRIMINATED decision, so a verdict exists exactly when there is one.
 *
 *  It previously paired `event` with `verdict: EstateVerdict | null` as
 *  INDEPENDENT fields, so the driver needed a "verdict missing for a verified
 *  event" branch that could never run.
 *
 *  exitCode is narrowed PER VARIANT, so 3 belongs to unreadable and 4 to stale
 *  by construction rather than by convention. It is retained deliberately: the
 *  agentic-loop rule forbids a decision crossing a boundary as an ANONYMOUS
 *  result object, and the payload here IS the versioned event. Deriving the
 *  exit code in the shell instead would be a SECOND implementation of a policy
 *  that already lives in exitCodeFor -- the drift this arc keeps removing. */
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
 *  The parameter is a VERSIONED OBSERVATION rather than an internal shape, and
 *  that is the whole point. The digest it carries was derived from the same
 *  porcelain bytes as its states, by the one authorized constructor, so a
 *  verdict cannot name evidence that came from somewhere else. Previously any
 *  caller -- including the injected gather function an in-process agent
 *  supplies -- could pair states from one estate with a digest from another. */
export function decideEstate(
  observation: EstateObservation,
  trace: SpanContext | null = null,
  expectDigest: Digest | null = null,
  // Threaded, never read here: the decider stays pure and the shell decides
  // what "now" means.
  timestamp: Timestamp = TimestampSchema.parse('1970-01-01T00:00:00.000Z'),
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
        ),
        exitCode: exitCodeFor('REPAIR_TOOLING'),
      };
    case 'fleet.estate.observed': {
      const actual = estateDigest(observation.states);
      // COMPARE-AND-SWAP, before any verdict is reported: a caller that pinned
      // a digest is asking to act only on THAT estate, and reporting a verdict
      // for a different one is the lost update the check exists to prevent.
      if (expectDigest !== null && expectDigest !== actual) {
        return {
          kind: 'stale',
          event: estateStaleEvent(expectDigest, actual, timestamp, trace),
          exitCode: exitCodeFor('REREAD_ESTATE'),
        };
      }
      const verdict = classifyEstate(observation.states);
      return {
        kind: 'verified',
        event: estateTelemetry(
          verdict, trace, actual, timestamp, observation.source_digest,
        ),
        exitCode: exitCodeFor(actionForVerdict(reasonsAcross(verdict.problems))),
        verdict,
      };
    }
    default:
      return unreachable(observation);
  }
}

/** The estate moved between the read and the act.
 *
 *  estate_digest let a caller RECORD what it observed; nothing let it BIND an
 *  action to that observation. This is the If-Match / 412 shape, value-based
 *  rather than a version counter: the digest IS the content, so it cannot drift
 *  from what it describes.
 *
 *  A DISTINCT event, because it is neither a verdict nor an unreadable estate.
 *  The estate was read perfectly well -- it simply is not the one the caller
 *  planned against, and the remediation is to re-read rather than to repair. */
export function estateStaleEvent(
  expectedDigest: Digest,
  actualDigest: Digest,
  timestamp: Timestamp,
  trace: SpanContext | null = null,
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
    attributes: { expected_digest: expectedDigest, estate_digest: actualDigest },
  };
}

/** RUNTIME schema for everything this task emits.
 *
 *  The events are the published contract: they carry schema_version and an
 *  agent parses them. They were hand-written interfaces with no runtime
 *  artifact, so nothing executable connected what we DECLARE to what we EMIT.
 *  Discriminated on event.name, so a parse failure names WHICH variant
 *  disagreed. strictObject throughout: an unrecognised key in an event WE
 *  construct is our own typo. */
const EventBaseShape = {
  schema_version: z.literal(ESTATE_SCHEMA_VERSION),
  // WHEN. An audit record without a timestamp cannot be placed in a sequence.
  // The clock is INJECTED, never read here.
  timestamp: TimestampSchema,
  // WHAT decided. The tool that produced this record, so a reader holding a
  // stream from several producers can attribute one line to one tool.
  producer: z.literal(ESTATE_PRODUCER),
  trace_id: TraceContextSchema.shape.trace_id.optional(),
  span_id: TraceContextSchema.shape.span_id.optional(),
  // WHAT THE CALLER MAY DO. An orchestrator reading this stream off a collector
  // never sees an exit code, so without this field it re-derives the policy
  // from attributes -- a second implementation waiting to disagree.
  //
  // ADVISORY, NEVER AUTHORIZATION: no field a tool emits is self-authorizing,
  // and a consumer treating PROCEED as consent is the confused-deputy failure.
  // The policy decision point sits OUTSIDE this tool; what the tool owes it is
  // a recommendation bound to the evidence estate_digest names.
  agent_action: EstateActionSchema,
  parent_span_id: SpanContextSchema.shape.parent_span_id,
} as const;

export const EstateTelemetrySchema = z.strictObject({
  'event.name': z.literal('fleet.estate.verified'),
  ...EventBaseShape,
  // DERIVED from EstateSeveritySchema, not re-listed.
  severity_text: EstateSeveritySchema.shape.severity_text,
  severity_number: EstateSeveritySchema.shape.severity_number,
  // REQUIRED on a verdict: a recommendation whose evidence cannot be named is
  // one a downstream PDP cannot re-verify.
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

/** The event types, DERIVED from the schemas above rather than hand-written
 *  beside them. Nine tests once existed to prove the two agreed; with a single
 *  declaration there is nothing left to disagree. */
export type EstateTelemetry = z.infer<typeof EstateTelemetrySchema>;
export type EstateUnreadableEvent = z.infer<typeof EstateUnreadableEventSchema>;
export type EstateStaleEvent = z.infer<typeof EstateStaleEventSchema>;

/** A span of our own, inside the caller's trace.
 *
 *  Every event copied the PARENT's span_id verbatim, so this task's events
 *  claimed to belong to the parent's span and never appeared as an operation of
 *  their own -- a trace with a hole exactly where the work happened. W3C is
 *  explicit that a child generates a NEW span id and records the received one
 *  as its parent.
 *
 *  randomBytes, not Math.random: span ids must not collide across concurrent
 *  runs, and two laptops sweep the same estate simultaneously. */
export function newSpanId(rand: () => Buffer = () => randomBytes(8)): SpanId {
  const id = rand().toString('hex');
  return SpanIdSchema.parse(ALL_ZERO.test(id) ? '0'.repeat(15) + '1' : id);
}

/** Build this run's span context: same trace as the parent when one was
 *  supplied, a fresh span either way, and the parent recorded when present. */
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
