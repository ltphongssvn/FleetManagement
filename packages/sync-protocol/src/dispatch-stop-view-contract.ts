// packages/sync-protocol/src/dispatch-stop-view-contract.ts
// Zod-first read-model contract (2026 contract-first): the SINGLE SOURCE OF TRUTH
// for what ops-web renders on the dispatch board. There is exactly ONE definition
// of the board row shape — the API response type and the ops-web parse type are
// both z.infer of the schemas below (no parallel hand-written interfaces, no
// duplicated parse schema).
//
// Strictness follows Postel / the 2026 tolerant-reader standard for API contracts:
//   - INBOUND-at-the-server + API-AUTHORED-OUTGOING shapes are .strict()
//     (StopProofSchema, DispatchStopViewSchema) so the server catches its own
//     drift in dev-time response validation.
//   - The CLIENT-PARSED board response shapes (DispatchBoardStop/Row/Response)
//     are tolerant (Zod default strip): they drop unknown keys instead of
//     throwing, so EXPAND-only additive server fields never break ops-web, and
//     the API's per-stop stopId (which this read projection does not use) is
//     silently dropped — preserving the former non-strict loader behaviour.
//
// Per stop, proof is non-null once a committed manifest is associated with that
// stop -> ops-web renders a "Phieu Can" hyperlink to proof.photoUrl; otherwise it
// shows the arrival status. photoUrl is a short-lived presigned S3 GET URL minted
// by the API (never a raw bucket path), so the private bucket is never exposed.
import { z } from 'zod';
import { EXTRACTION_FAILURE_REASONS } from './extraction-vocabulary.js';
import { ProofUrlSchema } from './proof-url.js';

// STOP TYPE VOCABULARY -- the values actually PERSISTED in stop.stop_type.
//
// This array documents REALITY, not an aspiration. A production census
// (SELECT DISTINCT stop_type FROM stop) returns FOUR values: pickup, delivery,
// dropoff, return. The previous declaration listed only two, and three defects
// followed from that gap:
//
//   1. computeWeightDiffKg matched stopType === 'delivery' by direct equality,
//      its comment asserting that was exhaustive. Every order whose delivery leg
//      is typed 'dropoff' returned null -- indistinguishable from the legitimate
//      "weight not extracted yet" null, so the Chenh lech column was silently
//      blank for those orders with nothing to indicate why.
//   2. Five call sites independently aliased delivery || dropoff, which is the
//      per-call-site duplication the SSOT rule exists to forbid.
//   3. Two read paths CAST a raw DB string into this union rather than parsing
//      it, silencing the compiler exactly where validation was required.
//
// WHY WIDEN RATHER THAN MIGRATE THE DATA. 2026 expand-contract guidance is
// explicit: widen in place, never narrow directly. Rewriting live dropoff/return
// rows down to two values would destroy a real distinction -- a RETURNED load is
// not a DELIVERED load -- and returns would silently become billable. So the
// vocabulary records what is stored, and MEANING is derived on top of it.
export const STOP_TYPES = Object.freeze(['pickup', 'delivery', 'dropoff', 'return'] as const);
export type StopType = (typeof STOP_TYPES)[number];

/** Parses an untrusted stop_type, NORMALIZING before matching.
 *
 *  The column is varchar(32) with no database constraint and the create DTO
 *  accepts any string up to 32 characters, so every read crosses a trust
 *  boundary and mixed case or stray whitespace is reachable by construction --
 *  not hypothetically: three services already call .toLowerCase() before
 *  comparing, which is only rational if someone believed it possible.
 *
 *  A STRICT z.enum HERE WOULD HAVE BEEN A PRODUCTION BREAK. It would reject any
 *  legacy 'Delivery' row, and DispatchBoardStopSchema parses this on the read
 *  path, so the board would blank rather than render. No test would have caught
 *  it: every fixture in this repo is lowercase. That is precisely why the first
 *  draft of this schema -- which asserted rejection, on an unevidenced comment
 *  claiming the column is stored lowercase -- was wrong.
 *
 *  Normalizing at the boundary is the house pattern; normalizeDisplayName states
 *  it as "normalize at ingestion so a name is byte-stable regardless of keying
 *  style". It also makes the ad-hoc .toLowerCase() call sites redundant, which
 *  is the actual SSOT win rather than a defensive nicety.
 *
 *  ORDER IS LOAD-BEARING: trim and lower-case run BEFORE the enum, so a padded
 *  or capitalised known value normalizes and passes, while an unknown value
 *  still FAILS after normalizing -- tolerance about spelling is not tolerance
 *  about vocabulary.
 *
 *  CONTRAST WITH FLEET_ROLES, deliberately opposite: role names REJECT case
 *  folding, because folding an authorization token lets a lookalike grant
 *  access. Stop types NORMALIZE it, because this is a data vocabulary and not a
 *  credential. Same shape, opposite answer, for a reason. */
export const StopTypeSchema = z.string().trim().toLowerCase().pipe(z.enum(STOP_TYPES));

// STOP ROLE -- the SEMANTIC classification consumers branch on, distinct from the
// persisted spelling above. Two concepts, deliberately separate: adding a synonym
// to the vocabulary must not require every consumer to learn it.
//
// 'return' is its OWN role and is never folded into 'delivery'. A returned load
// travelled back rather than reaching the customer, so treating it as a delivery
// would make it billable and would corrupt the pickup-vs-delivery reconciliation.
export const STOP_ROLES = Object.freeze(['pickup', 'delivery', 'return'] as const);
export type StopRole = (typeof STOP_ROLES)[number];

export const StopRoleSchema = z.enum(STOP_ROLES);

/** TOTAL classification of a persisted stop type into its semantic role.
 *
 *  'dropoff' folds onto 'delivery': the two are spellings of the same leg, which
 *  is why five call sites had each grown their own alias. That aliasing now
 *  lives here, once.
 *
 *  EXHAUSTIVE BY CONSTRUCTION: the switch covers the StopType union with no
 *  default branch, so adding a fifth value to STOP_TYPES makes this function
 *  non-exhaustive and FAILS THE BUILD until someone decides what it means. A new
 *  stop type can therefore never silently fall through to a wrong role -- the
 *  same compile-time guarantee deriveGoodsKg documents for phieu can layouts.
 *  A default branch would defeat exactly that, so there is none. */
export function classifyStopRole(stopType: StopType): StopRole {
  switch (stopType) {
    case 'pickup':
      return 'pickup';
    case 'delivery':
    case 'dropoff':
      return 'delivery';
    case 'return':
      return 'return';
  }
}

/** Parse-then-classify for a RAW persisted stop_type, as DB read paths need it.
 *
 *  WHY THIS EXISTS RATHER THAN LETTING CALLERS COMPOSE THE TWO STEPS. Five call
 *  sites in apps/api read stop.stop_type as an unconstrained varchar(32) and
 *  must turn it into a semantic role -- two pickup lookups and two delivery
 *  lookups in transport-orders.service.ts, plus the slot filter in
 *  transport-orders-export.service.ts. Each had independently grown the same
 *  pair of steps, .toLowerCase() then compare against delivery || dropoff, which
 *  is exactly the per-call-site duplication the SSOT rule forbids. Exposing only
 *  StopTypeSchema and classifyStopRole would leave every caller to re-pair them,
 *  with five chances to pair them differently.
 *
 *  RETURNS null RATHER THAN THROWING. These are READ paths that render the
 *  dispatch board and build the Excel export. StopTypeSchema.parse would throw
 *  on a single unrecognised row and blank the ENTIRE board for every user --
 *  a catastrophic failure mode for a display query. null propagates instead,
 *  which is the rule computeWeightDiffKg already documents: never report a
 *  partial aggregate as if complete. An unclassifiable stop matches no slot and
 *  contributes to no total rather than being silently miscounted.
 *
 *  DELIBERATELY NOT FAIL-SAFE-TO-PICKUP. The delivery-capture gate classifies an
 *  unknown type as 'pickup', and for a PHOTO GATE that is the conservative
 *  choice: it adds an obligation and cannot be bypassed. Here the same default
 *  would be actively wrong -- an unknown stop counted as a pickup skews the
 *  weight reconciliation and, once the accounting columns land, the billable
 *  total. Same question, different consequence, different answer. */
export function classifyRawStopRole(rawStopType: string): StopRole | null {
  const parsed = StopTypeSchema.safeParse(rawStopType);
  return parsed.success ? classifyStopRole(parsed.data) : null;
}

// Road-run lifecycle vocabulary. SSOT is @fleet/domain RoadRunStateSchema
// (packages/domain/src/transport/road-run-state.ts); inlined here (NOT imported)
// so this contract package stays dependency-free (zod only), matching how the
// manifest extraction enums are inlined in this same file's neighbours. Kept in
// lockstep with @fleet/domain by the contract tests.
export const ROAD_RUN_STATES = [
  'planned',
  'dispatched',
  'started',
  'completed',
  'cancelled',
] as const;
export type RoadRunStateName = (typeof ROAD_RUN_STATES)[number];

/** SSOT for a Phieu Can net-weight VALUE (kg): a finite positive number. One
 *  definition reused by StopProofSchema (read model) and ExtractionResultWire
 *  (worker callback) so "what a net weight is" lives in one place. The Excel
 *  export coerces the pg numeric(12,3) string through this same schema before
 *  writing the cell, so the exported number is contract-validated. */
export const netWeightKgSchema = z.number().positive();
export type NetWeightKg = z.infer<typeof netWeightKgSchema>;

/** SSOT for the pickup-vs-delivery weight DIFFERENCE (kg). Unlike netWeightKgSchema
 *  (a positive weight), a difference may be negative (delivery exceeds pickup) or
 *  zero, so it is a finite number with NO sign constraint. Computed server-side as
 *  (delivery stop weight) - (sum of pickup stop weights), and ONLY when every
 *  contributing stop weight is known (else null) — a partial diff would silently
 *  mislead the dispatcher's reconciliation (2026 missing-data best practice: never
 *  report a partial aggregate as if complete). */
export const weightDiffKgSchema = z.number();
export type WeightDiffKg = z.infer<typeof weightDiffKgSchema>;

/** Schema-first MINIMAL stop projection the weight-diff algorithm reads: just
 *  the leg (stopType) and its extracted Phieu Can net weight (kg) or null. This
 *  is the SSOT input both callers map INTO — the dispatch controller maps its
 *  richer DispatchStopView stops, and the Excel export maps its flat export rows
 *  — so the board column and the exported column share ONE computation and can
 *  never diverge. extractedNetWeightKg is a true blank (null) when unknown, never
 *  0, so an absent weight forces the whole diff to null rather than skewing it. */
export const WeightDiffStopSchema = z
  .object({
    stopType: StopTypeSchema,
    extractedNetWeightKg: z.union([netWeightKgSchema, z.null()]),
  })
  .strict();
export type WeightDiffStop = z.infer<typeof WeightDiffStopSchema>;

/** SSOT pickup-vs-delivery net-weight difference (kg) for ONE road run, computed
 *  from the already-resolved stop weights. Sign convention: positive => more
 *  delivered than picked up. Returns null UNLESS every contributing weight is
 *  known (all pickup stop weights AND the delivery stop weight), because a partial
 *  aggregate would silently misrepresent the dispatcher reconciliation (2026
 *  missing-data best practice). Pure + dependency-free; the SINGLE definition
 *  shared by GET /dispatch/board and the Excel export so the two never diverge. */
export function computeWeightDiffKg(stops: readonly WeightDiffStop[]): WeightDiffKg | null {
  // Legs are resolved through classifyStopRole, NOT by comparing stopType
  // directly. The previous implementation matched stopType === 'delivery' and
  // its comment claimed that was exhaustive -- it was not: a delivery leg
  // persisted as 'dropoff' matched nothing, so this returned null and the board
  // showed a blank Chenh lech indistinguishable from an unextracted weight.
  //
  // 'return' is deliberately EXCLUDED from both sides. A returned load neither
  // counts as picked up for the customer nor as delivered, so including it in
  // either total would misstate the reconciliation.
  const roled = stops.map((s) => ({
    role: classifyStopRole(s.stopType),
    kg: s.extractedNetWeightKg,
  }));
  const pickups = roled.filter((s) => s.role === 'pickup');
  const delivery = roled.find((s) => s.role === 'delivery');
  if (pickups.length === 0 || delivery === undefined) return null;
  const deliveryKg = delivery.kg;
  if (deliveryKg === null) return null;
  let pickupTotal = 0;
  for (const p of pickups) {
    const kg = p.kg;
    if (kg === null) return null;
    pickupTotal += kg;
  }
  return deliveryKg - pickupTotal;
}

/** Proof of capture for a stop: the committed manifest + a presigned GET URL.
 *  .strict(): this is the API-authored outgoing shape, validated server-side. */
export const StopProofSchema = z
  .object({
    manifestId: z.guid(),
    // ProofUrlSchema, NOT a bare z.url(). Zod documents z.url() as "quite
    // permissive" -- it delegates to the native URL constructor, so mailto:,
    // data:, file: and javascript: all parse successfully. Verified against zod
    // 4.4.3 in this repo rather than assumed: a RED test asserting rejection
    // failed on every one of them.
    //
    // ops-web renders this value directly into an anchor href (board-stops.tsx),
    // so an unconstrained scheme is stored XSS. The scheme allowlist lives in
    // proof-url.ts as one definition, so the API-authored outgoing shape and the
    // ops-web client-parsed shape can never disagree about what is renderable.
    photoUrl: ProofUrlSchema,
    capturedAt: z.iso.datetime(),
    // EXPAND-only (phieu-can net-weight extraction): net goods weight in kg parsed
    // from the committed Phieu Can by the extraction worker. optional => old
    // producers omitting the key stay valid; null => extraction pending/failed;
    // positive number => render kg next to the Phieu Can link.
    extractedNetWeightKg: z.union([netWeightKgSchema, z.null()]).optional(),
    // EXPAND-only: extraction lifecycle status so the board renders the four UI
    // states distinctly — 'pending' (processing) vs 'not_found'/'unreadable'
    // (needs manual entry) vs 'extracted'/'manual' (has a value). Vocabulary is
    // the SSOT @fleet/domain manifestExtractionStatusSchema; inlined here (not
    // imported) to keep the contract package dependency-free. optional => old
    // producers stay valid.
    extractionStatus: z
      .enum(['pending', 'extracted', 'not_found', 'unreadable', 'manual'])
      .optional(),
    // EXPAND-only (review queue): the deterministic cause of a non-extracted
    // outcome, so the board can show WHY (unparseable vs object_missing vs ...)
    // and filter a dispatcher review queue — not just the bare 'unreadable'
    // status. Vocabulary is the SSOT @fleet/sync-protocol EXTRACTION_FAILURE_REASONS;
    // inlined here to keep the contract dependency-free. optional => old producers
    // stay valid; null => pending/extracted/manual rows carry no reason.
    extractionReason: z.enum(EXTRACTION_FAILURE_REASONS).nullable().optional(),
  })
  .strict();
export type StopProof = z.infer<typeof StopProofSchema>;

/** One stop as the dispatch board sees it (API-authored outgoing shape, .strict()).
 *  proof === null => no committed photo yet (render arrival status); non-null =>
 *  render the "Phieu Can" link. */
export const DispatchStopViewSchema = z
  .object({
    stopId: z.guid(),
    sequence: z.number().int().positive(),
    stopType: StopTypeSchema,
    warehouseName: z.union([z.string(), z.null()]),
    // Preserved from the pre-existing DispatchBoardStop shape (EXPAND-only): the
    // board still shows arrival/departure; proof is ADDED, nothing removed, so old
    // ops-web code stays valid.
    arrivedAt: z.union([z.iso.datetime(), z.null()]),
    departedAt: z.union([z.iso.datetime(), z.null()]),
    // proof === null => no committed manifest for this stop (render arrival status);
    // non-null => render the "Phieu Can" hyperlink to proof.photoUrl.
    proof: z.union([StopProofSchema, z.null()]),
  })
  .strict();
export type DispatchStopView = z.infer<typeof DispatchStopViewSchema>;

// ============================================================================
// Canonical dispatch BOARD ROW contract (2026 consolidation). This is the wire
// shape returned by GET /dispatch/board and parsed by the ops-web RSC loader.
// It REPLACES the three former parallel definitions (the API's hand-written
// DispatchBoardRow/DispatchBoardStop interfaces, the ops-web BoardRowSchema/
// BoardStopSchema parse schemas, and the ops-web types.ts interface mirrors):
// both sides now z.infer these. These are CLIENT-PARSED shapes, so they are
// tolerant (Zod default strip — NOT .strict()): EXPAND-only nullable + .default()
// for missing fields, and unknown keys are dropped rather than rejected.
// ============================================================================

/** Board stop as the loader PARSES it. Tolerant (strip): looser datetime than
 *  DispatchStopViewSchema on purpose (the projection emits ISO strings the loader
 *  does not re-validate as .datetime()), proof nullable + defaulted so a pre-proof
 *  API still parses, and the API's per-stop stopId is silently dropped (this read
 *  projection does not use it) — preserving the former non-strict loader shape.
 *
 *  TOLERANCE HAS A LIMIT, and this shape has hit it twice. Dropping unknown KEYS
 *  is the Postel property it wants. Accepting an unvalidated VALUE in a KNOWN
 *  field is not tolerance -- it is an unchecked read, and this is the shape
 *  ops-web actually parses before rendering, so it is the boundary that protects
 *  every downstream sink. Two independent arcs found the same lesson here:
 *
 *    - stopType was z.string(), enforcing nothing. It is now the SSOT schema,
 *      which NORMALIZES case and whitespace before matching the four PERSISTED
 *      values. Widening the vocabulary is what made enforcing it safe at all:
 *      the previous two-value union would have rejected live dropoff rows.
 *    - photoUrl was a bare z.url(), which Zod documents as permissive enough to
 *      accept javascript: and data:. The nested StopProofSchema now enforces the
 *      http(s) scheme allowlist here too, guarding the anchor href ops-web
 *      renders it into.
 */
export const DispatchBoardStopSchema = z.object({
  sequence: z.number().int(),
  stopType: StopTypeSchema,
  warehouseName: z.union([z.string(), z.null()]),
  arrivedAt: z.union([z.string(), z.null()]),
  departedAt: z.union([z.string(), z.null()]),
  proof: z.union([StopProofSchema, z.null()]).default(null),
});
export type DispatchBoardStop = z.infer<typeof DispatchBoardStopSchema>;

/** One dispatch board row (one road_run). Server-resolved driver/vehicle/customer
 *  labels + ordered stops. Tolerant (strip). Nullable + defaulted fields are
 *  EXPAND-only carry-overs so an older API that omits them still parses. */
export const DispatchBoardRowSchema = z.object({
  roadRunId: z.guid(),
  state: z.enum(ROAD_RUN_STATES),
  assignedOperatorId: z.union([z.guid(), z.null()]),
  assignedAssetId: z.union([z.guid(), z.null()]),
  driverName: z.union([z.string(), z.null()]).default(null),
  vehiclePlate: z.union([z.string(), z.null()]).default(null),
  plannedStartAt: z.union([z.string(), z.null()]),
  stopCount: z.number().int().nonnegative(),
  transportOrderRefs: z.array(z.string()).readonly(),
  customerName: z.union([z.string(), z.null()]).default(null),
  customerPhone: z.union([z.string(), z.null()]).default(null),
  // Ten hang (T18): the transport order cargo type name, resolved read-time by
  // the board join transport_order -> cargo_type. EXPAND-only: nullable + default
  // so an older API that omits it still parses, and null when the order has no
  // cargo type (transport_order.cargo_type_id is nullable) or weights unresolved.
  cargoName: z.union([z.string(), z.null()]).default(null),
  // Feature 3 (2026): pickup-vs-delivery net-weight difference (kg), computed
  // server-side = (delivery stop weight) - (sum of pickup stop weights); null
  // unless EVERY contributing weight is known. EXPAND-only: nullable + default
  // so an older API that omits it still parses.
  weightDiffKg: z.union([weightDiffKgSchema, z.null()]).default(null),
  stops: z.array(DispatchBoardStopSchema).readonly().default([]),
});
export type DispatchBoardRow = z.infer<typeof DispatchBoardRowSchema>;

/** Full GET /dispatch/board response envelope. Tolerant (strip). */
export const DispatchBoardResponseSchema = z.object({
  rows: z.array(DispatchBoardRowSchema).readonly(),
});
export type DispatchBoardResponse = z.infer<typeof DispatchBoardResponseSchema>;

// ----------------------------------------------------------------------------
// API-PRODUCED row view (2026 base+derive, single source of truth). The dispatch
// API controller returns rows whose stops are the API-AUTHORED DispatchStopView
// (which carries the internal stopId it needs for proof association, validated
// strictly server-side). DERIVED from DispatchBoardRowSchema by swapping ONLY the
// stop variant via .extend, so every shared ROW field rule is reused from the one
// canonical row schema — the controller infers these types instead of hand-writing
// interfaces. ops-web continues to parse the leaner DispatchBoardRowSchema (stops
// without stopId), per Postel (server emits richer; client parses leaner).
// ----------------------------------------------------------------------------
export const DispatchBoardApiRowSchema = DispatchBoardRowSchema.extend({
  stops: z.array(DispatchStopViewSchema).readonly().default([]),
});
export type DispatchBoardApiRow = z.infer<typeof DispatchBoardApiRowSchema>;

/** Full GET /dispatch/board response as the API PRODUCES it (stops carry stopId). */
export const DispatchBoardApiResponseSchema = z.object({
  rows: z.array(DispatchBoardApiRowSchema).readonly(),
});
export type DispatchBoardApiResponse = z.infer<typeof DispatchBoardApiResponseSchema>;
