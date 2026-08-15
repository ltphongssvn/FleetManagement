// scripts/estate-events.ts
// THE EVENT ENVELOPE: what every event in this arc carries, declared once.
//
// WHY THIS FILE EXISTS. The 2026 agentic-loop rule requires every observation
// AND every decision to be a versioned, schema-validated event carrying
// provenance and causality. This arc satisfied half: the OUTPUTS were events
// (versioned, timestamped, producer-stamped), while the INPUT was an
// unversioned internal shape -- {kind:'states', states, sourceDigest} -- that
// nothing parsed. The rule names that shape as forbidden by example, and the
// asymmetry had a concrete exploit: runEstateVerify takes its gather function
// by INJECTION, so an agent could supply states from one estate beside a
// sourceDigest from anywhere. source_digest exists precisely to answer "did the
// estate move, or did the parser change" -- evidence that can be fabricated
// answers nothing.
//
// A LEAF, deliberately, so the observation and decision schemas can extend the
// envelope without a cycle: estate-vocabulary <- estate-events <- estate-verify.
//
// WHAT THIS FILE DOES NOT ADD, so nobody adds it by reflex: no event store, no
// broker. The rule is explicit that event-driven is not automatically
// event-sourced and that durable infrastructure belongs at real process
// boundaries. estate:verify is a short-lived CLI whose stdout NDJSON IS its
// publication channel; a Kafka topic here would be the shape of rigour without
// the substance.
//
// WHY NOT CLOUDEVENTS ATTRIBUTE NAMES. CloudEvents is the CNCF graduated
// standard and the right envelope when events cross vendors. This arc follows
// the OTel Logs/Events data model instead -- event.name, severity_number,
// trace_id, attributes/body -- because its consumer is an in-repo agent reading
// NDJSON, not a multi-cloud bus, and OTel is what the surrounding tooling
// already speaks. Adopted FROM CloudEvents: correlation and causation as
// first-class attributes, and the deterministic content-derived id below.
//
// HASHING IS NOT SIGNING. sha256 establishes "these bytes produce this digest";
// it does NOT establish "a trusted producer generated these bytes". Producer
// authenticity needs a signature or an authenticated transport, which this
// local tool deliberately does not fake -- signer and verifier would be the
// same principal, proving nothing.
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** A sha256 content address, ALGORITHM-PREFIXED.
 *
 *  The bare-hex form could not express which algorithm produced it, so the day
 *  sha256 is retired every stored address becomes ambiguous with no way to tell
 *  old from new. Multihash-style prefixing is the standard answer and costs one
 *  major version now rather than a forced migration later.
 *
 *  BRANDED, because a z.infer of an unbranded string IS string: every call site
 *  would accept any string at all. The limit is worth stating -- branding is a
 *  COMPILE-time guarantee, and a hostile runtime payload can still carry a
 *  forged string, which is why every trust boundary parses rather than trusts
 *  the type. */
export const DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256: prefixed hex digest')
  .brand<'Digest'>();
export type Digest = z.infer<typeof DigestSchema>;

/** sha256 of any text, prefixed and parsed. The single hashing function for
 *  this arc, so a snapshot digest and a source digest are provably the same
 *  computation -- two hashes computed two ways is a discrepancy waiting to be
 *  misread. parse, never a cast: the brand is only sound if the value went
 *  through the schema. */
export function digestOf(text: string): Digest {
  return DigestSchema.parse('sha256:' + createHash('sha256').update(text).digest('hex'));
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
 *  This is the correction that matters. A random id would make the decider
 *  non-deterministic, so replaying the same observation would produce a
 *  different event every time and the byte-identical-event property this arc
 *  already tests would be false. The rule demands "the same agent decisions
 *  when replaying any historical event sequence"; a random id contradicts it.
 *  2026 practice derives the id from the payload (uuidv5-style) precisely so it
 *  doubles as an idempotency key: the same facts always yield the same id.
 *
 *  RFC 4122 v5: sha1 over namespace bytes + name, with the version and variant
 *  bits overwritten. sha1 is used here as a NON-SECURITY digest, exactly as the
 *  UUID spec prescribes; the security property in this arc comes from the
 *  sha256 digests, never from the id. */
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
const ALL_ZERO = /^0+$/;

/** The negation lives HERE, once, at the definition. Two earlier revisions
 *  wrote `ALL_ZERO.test(v) === false` at each call site to keep a bang out of
 *  a shell heredoc -- a transport worry that does not even exist, since a
 *  quoted delimiter suppresses all expansion. The lint rule was right both
 *  times, and shaping source around an imagined shell constraint is how a
 *  workaround outlives the problem it was invented for. */
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
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256: prefixed decision token')
  .brand<'DecisionToken'>();
export type DecisionToken = z.infer<typeof DecisionTokenSchema>;

/** Schema version on EVERY event this arc emits.
 *
 *  2.0.0, and the MAJOR bump is deliberate: three breaking changes land at once
 *  -- the observation becomes a versioned event rather than an internal shape,
 *  the envelope gains event_id/correlation_id/causation_id, and digests gain
 *  the sha256: prefix. A consumer pinned to 1.2.0 could misread any of them,
 *  and a breaking change gets a major bump, never a quiet reshape of the same
 *  version. */
export const ESTATE_SCHEMA_VERSION = '2.0.0';

/** WHAT produced the record. A literal, so a consumer can pin it and a typo
 *  cannot masquerade as another tool. NOT a human or machine ACTOR: this runs
 *  on a laptop with no verifiable identity to assert, and an unverifiable
 *  identity claim reads as evidence while carrying none. */
export const ESTATE_PRODUCER = 'estate:verify';

/** Every event carries this. Spread FLAT into each event schema rather than
 *  nested, so a consumer inspects provenance without deserialising a payload --
 *  the separation of context from data that CloudEvents exists to formalise.
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
