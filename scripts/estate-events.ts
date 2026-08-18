// scripts/estate-events.ts
// THE SHARED KERNEL: the domain primitives and the event envelope every other
// module of this arc is built from, each declared ONCE.
//
// WHY A KERNEL AND NOT TWO MODULES. decideEstate must consume an OBSERVATION
// event, and the observation carries WorktreeState. Those two lived in
// different modules -- the observation in estate-gather, the state in
// estate-verify -- while estate-gather already imports estate-verify. Wiring
// the decider to the observation would have closed that loop into a CYCLE, and
// a cycle here is not academic: ESM evaluates children before parents, so a
// module-scope schema read across one throws only when load order puts the
// reader first, which changes whenever any import is added anywhere.
//
// The 2026 techniques for breaking a cycle are demotion, escalation,
// dependency inversion and merging. DEMOTION is the honest one here:
// WorktreeStateSchema depends on nothing but zod and node:path, so it was a
// domain primitive sitting in the wrong module rather than a genuine
// dependency of the classifier. Moving it down lets the observation schemas sit
// beside it, and both estate-verify and estate-gather import DOWNWARD only.
//
// The alternative I rejected was typing decideEstate's parameter structurally
// so estate-gather's observation would satisfy it without an import. That is
// dependency inversion done IMPLICITLY -- an undeclared contract no reader can
// see and no guard can enforce -- and inverting a dependency to avoid moving a
// file is the shape of a workaround outliving its cause.
//
// WHAT THIS FILE DOES NOT ADD: no event store, no broker. Event-driven is not
// automatically event-sourced, and durable infrastructure belongs at real
// process boundaries. estate:verify is a short-lived CLI whose stdout NDJSON IS
// its publication channel.
//
// HASHING IS NOT SIGNING. sha256 establishes "these bytes produce this digest";
// it does NOT establish "a trusted producer generated these bytes". Producer
// authenticity needs a signature or an authenticated transport, which this
// local tool deliberately does not fake -- signer and verifier would be the
// same principal, proving nothing.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';

/** A sha256 content address, 64 lowercase hex characters.
 *
 *  BRANDED, because a z.infer of an unbranded string IS string: every call site
 *  would accept any string at all. The limit is worth stating -- branding is a
 *  COMPILE-time guarantee, and a hostile runtime payload can still carry a
 *  forged string, which is why every trust boundary parses rather than trusts
 *  the type. */
export const DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest')
  .brand<'Digest'>();
export type Digest = z.infer<typeof DigestSchema>;

/** sha256 of any text. The single hashing function for this arc, so a snapshot
 *  digest and a source digest are provably the same computation. parse, never a
 *  cast: the brand is only sound if the value went through the schema. */
export function digestOf(text: string): Digest {
  return DigestSchema.parse(createHash('sha256').update(text).digest('hex'));
}

/** WHEN, as an instant. Branded because it sits ADJACENT to digest parameters
 *  in every event constructor, and that swap already happened twice in this
 *  arc -- caught only at runtime, by a schema, inside a test. */
export const TimestampSchema = z.iso.datetime().brand<'Timestamp'>();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** The identity of ONE event occurrence, so a consumer can deduplicate:
 *  re-delivery of the same event_id must never duplicate a side effect. */
export const EventIdSchema = z.uuid().brand<'EventId'>();
export type EventId = z.infer<typeof EventIdSchema>;

/** The thread a whole workflow shares. DISTINCT from causation: correlation
 *  answers "which run was this part of", causation answers "what produced this
 *  one". Conflating them is how a causal chain becomes unwalkable. */
export const CorrelationIdSchema = z.uuid().brand<'CorrelationId'>();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

/** A DETERMINISTIC event id, derived from content -- never randomUUID.
 *
 *  A random id would make the decider non-deterministic, so replaying the same
 *  observation would produce a different event every run and the
 *  byte-identical-event property this arc already tests would be false -- while
 *  the same rule demands "the same agent decisions when replaying any
 *  historical event sequence". 2026 practice derives the id from the payload,
 *  uuidv5-style, so it doubles as an idempotency key.
 *
 *  RFC 4122 v5: sha1 over namespace bytes + name, with the version and variant
 *  bits overwritten. sha1 is used here as a NON-SECURITY digest, exactly as the
 *  UUID spec prescribes; every security property comes from the sha256 digests. */
const UUID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export function eventIdFor(name: string, content: string): EventId {
  const ns = Buffer.from(UUID_NAMESPACE.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name).update(content).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('uuid derivation failed');
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return EventIdSchema.parse(
    hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20),
  );
}

/** The two W3C ids, branded SEPARATELY: both are lowercase hex differing only
 *  in length, so structural typing lets a span id sit where a trace id belongs
 *  and says nothing. Kept ALONGSIDE the event ids -- trace/span serve
 *  OpenTelemetry correlation across tools, while event_id and causation_id
 *  serve this log's own causal chain. */
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
export const ALL_ZERO = /^0+$/;

/** The negation lives HERE, once, at the definition. Two earlier revisions
 *  wrote the comparison form at each call site to keep a bang out of a shell
 *  heredoc -- a constraint that does not exist, since a quoted delimiter
 *  suppresses all expansion. */
function notAllZero(v: string): boolean {
  return !ALL_ZERO.test(v);
}

export const TraceIdSchema = z
  .string()
  .regex(TRACE_ID)
  .refine(notAllZero, 'trace_id must not be all zero')
  .brand<'TraceId'>();
export type TraceId = z.infer<typeof TraceIdSchema>;

export const SpanIdSchema = z
  .string()
  .regex(SPAN_ID)
  .refine(notAllZero, 'span_id must not be all zero')
  .brand<'SpanId'>();
export type SpanId = z.infer<typeof SpanIdSchema>;

/** What a downstream policy decision point receives INSTEAD of a boolean.
 *
 *  DERIVED FROM THE EVIDENCE, never invented, so a token cannot be minted for a
 *  decision nobody made and a token presented against a different estate does
 *  not re-derive. It is NOT authorization -- no field a tool emits is
 *  self-authorizing -- it is a checkable reference the PDP recomputes. */
export const DecisionTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex decision token')
  .brand<'DecisionToken'>();
export type DecisionToken = z.infer<typeof DecisionTokenSchema>;

/** Schema version on EVERY event this arc emits. ONE constant, referenced by
 *  every variant, so a bump cannot land on some events and miss others.
 *
 *  SEMVER: PATCH for documentation, MINOR for a backward-compatible addition,
 *  MAJOR for anything an existing reader could misinterpret. A changed MEANING
 *  is major even when the shape is identical.
 *
 *  2.0.0, and this bump is EARNED rather than cosmetic. Every emitted event now
 *  carries a REQUIRED policy_digest naming the rules that produced its
 *  agent_action. A consumer pinned to 1.2.0 would meet a field its contract does
 *  not declare, and -- worse -- would keep reading agent_action as if the rules
 *  behind it were the ones it was written against. That is precisely "anything
 *  an existing reader could misinterpret".
 *
 *  An earlier revision of this arc set 2.0.0 speculatively, for a shape change
 *  that was not yet wired, and it was reverted to 1.2.0 on the reasoning that a
 *  version bump for a change no consumer can observe is a false signal. That
 *  reasoning was right then and is spent now: the change is observable, so the
 *  bump lands with the shape that earns it rather than ahead of it. */
export const ESTATE_SCHEMA_VERSION = '2.0.0';
export type EstateSchemaVersion = typeof ESTATE_SCHEMA_VERSION;

/** WHAT produced the record. A literal, so a consumer can pin it and a typo
 *  cannot masquerade as another tool. NOT a human or machine ACTOR: this runs
 *  on a laptop with no verifiable identity to assert, and an unverifiable
 *  identity claim reads as evidence while carrying none. */
export const ESTATE_PRODUCER = 'estate:verify';

/** One worktree, as observed from git. Parsed at the boundary, never cast.
 *
 *  DEMOTED HERE from estate-verify.ts. It depends on nothing but zod and
 *  node:path, so it was a domain primitive sitting above the observation event
 *  that carries it -- the placement that would have forced a cycle once the
 *  decider began consuming observations.
 *
 *  strictObject, not object: this literal is assembled from git output, so an
 *  unrecognised key means OUR OWN typo -- writing stashcount for stashCount
 *  would otherwise be stripped in silence and read as 0, a clean worktree
 *  reported for a dirty one from a single wrong letter. */
export const WorktreeStateSchema = z.strictObject({
  // Git always reports an ABSOLUTE path. Requiring one is not decoration: this
  // value becomes the `cwd` of subsequent git calls, so a relative or
  // control-character path signals a PARSE failure and must never reach a
  // subprocess. A newline is the sharp case -- porcelain is line-oriented, so a
  // path containing one silently desynchronises the parse.
  path: z.string().min(1)
    .refine((v) => v.startsWith('/'), 'worktree path must be absolute')
    .refine(
      // CANONICAL FORM at the boundary. A path carrying .. or a trailing slash
      // denotes the same worktree yet compares unequal, and canonicalisation
      // must precede validation -- sanitising raw strings is how every
      // traversal bypass works. Confinement to an "estate root" is deliberately
      // absent: worktrees legitimately live outside the repo, so a root check
      // would reject every real path.
      (v) => v === resolve(v),
      'worktree path must already be canonical',
    )
    .refine(
      // A PREDICATE, not a regex: no-control-regex is right that a control
      // character inside a pattern is usually accidental, and checking code
      // points states the intent without needing a suppression.
      (v) => {
        for (let i = 0; i < v.length; i += 1) {
          const code = v.charCodeAt(i);
          if (code < 0x20 || code === 0x7f) return false;
        }
        return true;
      },
      'worktree path must not contain control characters',
    ),
  // NO CONTROL CHARACTERS, and not for symmetry: this value is interpolated RAW
  // into the operator sentence on stderr, so an ESC byte reaches a terminal
  // unescaped. 2026 has a run of CVEs in this class, including command
  // injection through a BRANCH NAME, which is attacker-controllable in any
  // shared repository. The concealment case is what matters for an agent:
  // rendering hides these bytes from a person while a model reads raw text.
  branch: z.string().refine(
    (v) => {
      for (let i = 0; i < v.length; i += 1) {
        const code = v.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    },
    'branch must not contain control characters',
  ),
  dirtyFileCount: z.number().int().nonnegative(),
  aheadOfRemote: z.number().int().nonnegative(),
  stashCount: z.number().int().nonnegative(),
  prunable: z.boolean(),
  locked: z.boolean(),
}).brand<"WorktreeState">();
// BRANDED, so the type cannot be produced by writing an object literal. The
// schema is the only constructor, so "the driver forgot to parse" becomes a
// COMPILE error instead of a runtime hazard -- and NOT a re-parse inside every
// helper, which is the redundant-validation anti-pattern the two-axis rule
// names.
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/** Every event carries this. Spread FLAT into each event schema rather than
 *  nested, so a consumer inspects provenance without deserialising a payload --
 *  the separation of context from data that CloudEvents formalises.
 *
 *  causation_id is NULLABLE and that is meaningful: null marks the ROOT of a
 *  causal chain, an observation caused by the world rather than by another
 *  event. A non-null value names the exact event that produced this one, so a
 *  reader walks the chain backwards instead of guessing from timestamps. */
export const EventEnvelopeShape = {
  schema_version: z.literal(ESTATE_SCHEMA_VERSION),
  event_id: EventIdSchema,
  correlation_id: CorrelationIdSchema,
  causation_id: EventIdSchema.nullable(),
  occurred_at: TimestampSchema,
  producer: z.literal(ESTATE_PRODUCER),
  trace_id: TraceIdSchema.optional(),
  span_id: SpanIdSchema.optional(),
  parent_span_id: SpanIdSchema.optional(),
} as const;

export const EventEnvelopeSchema = z.strictObject(EventEnvelopeShape);
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** WHY THE OBSERVATION COULD NOT BE MADE. Codes, so a router acts without
 *  parsing prose. Distinct from the estate being unclean: these say the estate
 *  was never read at all. */
export const UNOBSERVABLE_REASONS = Object.freeze([
  'git-failed',
  'no-records',
  'record-rejected',
] as const);
export type UnobservableReason = (typeof UNOBSERVABLE_REASONS)[number];

/** THE OBSERVATION EVENT -- the fact the decider consumes.
 *
 *  It replaces {kind:'states', states, sourceDigest}, an internal shape with no
 *  event name, no schema version and no parse step, which the 2026 agentic-loop
 *  rule names as forbidden by example. The asymmetry was real: outputs were
 *  versioned events while the input was a bare object, so runEstateVerify --
 *  whose gather function is INJECTED, and therefore agent-supplied -- accepted
 *  states from one estate beside a digest from anywhere. */
export const EstateObservedSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.observed'),
  ...EventEnvelopeShape,
  source_digest: DigestSchema,
  states: z.array(WorktreeStateSchema).readonly(),
});
export type EstateObserved = z.infer<typeof EstateObservedSchema>;

/** AN OBSERVATION THAT OBSERVED NOTHING is a different fact from an observation
 *  of an empty estate, and giving it its own event name keeps the two from
 *  sharing a shape. That confusion IS the confident zero this arc exists to
 *  refuse: `git worktree list` in any valid repository lists at least the MAIN
 *  worktree, so zero records is never a legitimate answer.
 *
 *  source_digest is OPTIONAL here and required above, which is not sloppiness:
 *  a git command that could not run produced no porcelain, so there are no
 *  bytes to address, and claiming a digest for absent evidence would fabricate
 *  provenance. */
export const EstateUnobservableSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.unobservable'),
  ...EventEnvelopeShape,
  reason: z.enum(UNOBSERVABLE_REASONS),
  source_digest: DigestSchema.optional(),
});
export type EstateUnobservable = z.infer<typeof EstateUnobservableSchema>;

/** The closed set of observations. event.name is the discriminant, matching the
 *  emitted events, so one rule reads every event this arc produces. */
export const EstateObservationSchema = z.discriminatedUnion('event.name', [
  EstateObservedSchema,
  EstateUnobservableSchema,
]);
export type EstateObservation = z.infer<typeof EstateObservationSchema>;

/** What every observation needs beside the git output: the correlation it
 *  belongs to, the clock, and any inherited trace context. INJECTED, so the
 *  constructor stays pure and a test pins every field.
 *
 *  Declared beside the schemas rather than in estate-gather.ts, because the
 *  fixtures below need it too and a second declaration is the duplication this
 *  arc keeps removing. */
export interface ObservationContext {
  readonly correlationId: CorrelationId;
  readonly occurredAt: Timestamp;
  readonly traceId?: TraceId | undefined;
  readonly spanId?: SpanId | undefined;
  readonly parentSpanId?: SpanId | undefined;
}

/** The envelope every observation carries. EXPORTED so the authorized
 *  constructor in estate-gather.ts and the fixtures below build it the same
 *  way -- two envelope builders would be two chances to drift on a field that
 *  exists to make provenance readable. */
export function observationEnvelope(
  ctx: ObservationContext,
  eventId: EventId,
): Record<string, unknown> {
  return {
    schema_version: ESTATE_SCHEMA_VERSION,
    event_id: eventId,
    correlation_id: ctx.correlationId,
    // NULL: an observation is caused by the world, not by a prior event.
    causation_id: null,
    occurred_at: ctx.occurredAt,
    producer: ESTATE_PRODUCER,
    ...(ctx.traceId === undefined ? {} : { trace_id: ctx.traceId }),
    ...(ctx.spanId === undefined ? {} : { span_id: ctx.spanId }),
    ...(ctx.parentSpanId === undefined ? {} : { parent_span_id: ctx.parentSpanId }),
  };
}

/** A FIXED context for tests. Pinned rather than generated, because an event id
 *  derived from content plus a pinned correlation and clock is what makes the
 *  byte-identical-event assertions possible at all. */
const FIXTURE_CONTEXT: ObservationContext = {
  correlationId: CorrelationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  occurredAt: TimestampSchema.parse('2026-01-01T00:00:00.000Z'),
};

/** Test-fixture factories for the two observations.
 *
 *  DEFAULTS PLUS OVERRIDES, not a catalogue of named examples. 2026 guidance
 *  draws the line precisely: an Object Mother "removes repeated SELECTION" and
 *  suits a small stable vocabulary, while a builder "removes repeated
 *  CONSTRUCTION" and suits tests that need many independent variations from a
 *  valid default. These tests vary states and reasons freely, so construction
 *  is the repetition -- and the catalogue form is what grows into "80 vaguely
 *  named methods where nobody knows which fields matter".
 *
 *  CO-LOCATED with the schema, matching createWorktreeState and for its stated
 *  reason: a new envelope field is defaulted in ONE place rather than by a
 *  shotgun edit across five test files. Nothing ships -- scripts/ runs under
 *  tsx, so there is no bundle for a dev-only builder to bloat.
 *
 *  PARSED, never cast. A fixture that stops satisfying the contract fails AT
 *  CONSTRUCTION rather than in whichever test notices first, which is exactly
 *  the drift that let admin-drivers-client fixtures omit six required fields.
 *  It also means these go through the same door production does: a fixture
 *  cannot express an observation observeEstate could never produce. */
export function observedFixture(
  states: readonly WorktreeState[],
  sourceDigest: Digest,
  ctx: ObservationContext = FIXTURE_CONTEXT,
): EstateObserved {
  return EstateObservedSchema.parse({
    'event.name': 'fleet.estate.observed',
    ...observationEnvelope(ctx, eventIdFor('fleet.estate.observed', sourceDigest)),
    source_digest: sourceDigest,
    states,
  });
}

/** The unobservable half. sourceDigest stays OPTIONAL for the same reason it is
 *  optional on the schema: a git command that could not run produced no
 *  porcelain, so there are no bytes to address, and a fixture that supplied one
 *  anyway would let a test assert provenance production can never emit. */
export function unobservableFixture(
  reason: UnobservableReason,
  sourceDigest?: Digest,
  ctx: ObservationContext = FIXTURE_CONTEXT,
): EstateUnobservable {
  const eventId = eventIdFor('fleet.estate.unobservable', reason + (sourceDigest ?? ''));
  return EstateUnobservableSchema.parse({
    'event.name': 'fleet.estate.unobservable',
    ...observationEnvelope(ctx, eventId),
    reason,
    ...(sourceDigest === undefined ? {} : { source_digest: sourceDigest }),
  });
}
