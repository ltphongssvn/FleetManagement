// scripts/estate-events.ts
// THE EVENT ENVELOPE and the primitives every event in this arc is built from,
// each declared ONCE.
//
// WHY THIS FILE EXISTS. The 2026 agentic-loop rule requires every observation
// AND every decision to be a versioned, schema-validated event carrying
// provenance and causality. This arc satisfied half: the OUTPUTS were events,
// while the INPUT was an unversioned internal shape -- {kind:'states', states,
// sourceDigest} -- that nothing parsed. The rule names that shape as forbidden
// by example, and the gap had a concrete exploit: runEstateVerify takes its
// gather function by INJECTION, so an agent could supply states from one estate
// beside a sourceDigest from anywhere. source_digest exists to answer "did the
// estate move, or did the parser change" -- evidence that can be fabricated
// answers nothing.
//
// THE SSOT FOR THESE PRIMITIVES. DigestSchema, digestOf, TimestampSchema,
// TraceIdSchema, SpanIdSchema, the schema version and the producer live HERE
// and nowhere else; estate-verify.ts re-exports them so every existing consumer
// resolves unchanged. A previous revision declared them a SECOND time alongside
// estate-verify.ts's copies, which is the duplicate-type-definition shape 2026
// guidance calls TYPE DEBT: it "accumulates silently", "compounds", and is to
// be treated like a failing test rather than recorded for later.
//
// NO sha256: PREFIX, and the reason matters because an earlier draft added one.
// Algorithm-prefixed digests are genuinely better -- an address whose algorithm
// is implicit cannot be migrated -- but the agentic-loop rule mandates versioned
// events, evidence binding and a decision token, and says nothing about digest
// encoding. The prefix came from a code sample, and carrying it would break
// every fixture in a 1405-line suite for a property this refactor does not need.
// Algorithm agility deserves its own arc, judged on its own merits.
//
// STILL 1.2.0, likewise. An earlier draft set 2.0.0 because the observation
// event and the new envelope fields are breaking. They are -- but they are not
// WIRED yet, and a version bump for a change no consumer can observe is a false
// signal: it tells a reader the payload moved when nothing emitted has changed.
// The bump belongs in the same commit as the shape change that earns it.
//
// A LEAF, deliberately: estate-vocabulary and estate-events are both leaves, so
// the observation and decision schemas can extend the envelope without a cycle.
//
// WHAT THIS FILE DOES NOT ADD: no event store, no broker. The rule is explicit
// that event-driven is not automatically event-sourced and that durable
// infrastructure belongs at real process boundaries. estate:verify is a
// short-lived CLI whose stdout NDJSON IS its publication channel.
//
// HASHING IS NOT SIGNING. sha256 establishes "these bytes produce this digest";
// it does NOT establish "a trusted producer generated these bytes". Producer
// authenticity needs a signature or an authenticated transport, which this
// local tool deliberately does not fake -- signer and verifier would be the
// same principal, proving nothing.
import { createHash } from 'node:crypto';
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
 *  digest and a source digest are provably the same computation -- two hashes
 *  computed two ways is a discrepancy waiting to be misread. parse, never a
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
 *  answers "which run was this part of", causation answers "what produced
 *  this one". Conflating them is how a causal chain becomes unwalkable. */
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
 *  and says nothing. Kept ALONGSIDE the event ids rather than replaced by them
 *  -- trace/span serve OpenTelemetry correlation across tools, while event_id
 *  and causation_id serve this log's own causal chain. */
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
export const ALL_ZERO = /^0+$/;

/** The negation lives HERE, once, at the definition. Two earlier revisions
 *  wrote the comparison form at each call site to keep a bang out of a shell
 *  heredoc -- a constraint that does not exist, since a quoted delimiter
 *  suppresses all expansion. Shaping source around an imagined transport worry
 *  is how a workaround outlives the problem it was invented for. */
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
 *  DERIVED FROM THE EVIDENCE, never invented: the digest of the observation's
 *  id, the observed source digest and the classification. So a token cannot be
 *  minted for a decision nobody made, and a token presented against a different
 *  estate does not re-derive. It is NOT authorization -- no field a tool emits
 *  is self-authorizing -- it is a checkable reference the PDP recomputes. */
export const DecisionTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex decision token')
  .brand<'DecisionToken'>();
export type DecisionToken = z.infer<typeof DecisionTokenSchema>;

/** Schema version on EVERY event this arc emits. ONE constant, referenced by
 *  every variant, so a bump cannot land on some events and miss others.
 *
 *  SEMVER: PATCH for documentation or metadata, MINOR for a backward-compatible
 *  addition such as a new optional attribute, MAJOR for anything an existing
 *  reader could misinterpret -- a removed field, a narrowed enum, or the same
 *  field meaning something new. A changed MEANING is major even when the shape
 *  is identical. */
export const ESTATE_SCHEMA_VERSION = '1.2.0';
export type EstateSchemaVersion = typeof ESTATE_SCHEMA_VERSION;

/** WHAT produced the record. A literal, so a consumer can pin it and a typo
 *  cannot masquerade as another tool. NOT a human or machine ACTOR: this runs
 *  on a laptop with no verifiable identity to assert, and an unverifiable
 *  identity claim reads as evidence while carrying none. */
export const ESTATE_PRODUCER = 'estate:verify';

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
