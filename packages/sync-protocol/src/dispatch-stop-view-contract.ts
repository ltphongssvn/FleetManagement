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

export const STOP_TYPES = ['pickup', 'delivery'] as const;
export type StopType = typeof STOP_TYPES[number];

// Road-run lifecycle vocabulary. SSOT is @fleet/domain RoadRunStateSchema
// (packages/domain/src/transport/road-run-state.ts); inlined here (NOT imported)
// so this contract package stays dependency-free (zod only), matching how the
// manifest extraction enums are inlined in this same file's neighbours. Kept in
// lockstep with @fleet/domain by the contract tests.
export const ROAD_RUN_STATES = ['planned', 'dispatched', 'started', 'completed', 'cancelled'] as const;
export type RoadRunStateName = typeof ROAD_RUN_STATES[number];

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
export const WeightDiffStopSchema = z.object({
  stopType: z.enum(STOP_TYPES),
  extractedNetWeightKg: z.union([netWeightKgSchema, z.null()]),
}).strict();
export type WeightDiffStop = z.infer<typeof WeightDiffStopSchema>;

/** SSOT pickup-vs-delivery net-weight difference (kg) for ONE road run, computed
 *  from the already-resolved stop weights. Sign convention: positive => more
 *  delivered than picked up. Returns null UNLESS every contributing weight is
 *  known (all pickup stop weights AND the delivery stop weight), because a partial
 *  aggregate would silently misrepresent the dispatcher reconciliation (2026
 *  missing-data best practice). Pure + dependency-free; the SINGLE definition
 *  shared by GET /dispatch/board and the Excel export so the two never diverge. */
export function computeWeightDiffKg(stops: readonly WeightDiffStop[]): WeightDiffKg | null {
  // stopType is the STOP_TYPES literal union (pickup | delivery) per the schema,
  // so direct equality is exhaustive — no normalization or other-leg aliasing.
  const pickups = stops.filter((s) => s.stopType === 'pickup');
  const delivery = stops.find((s) => s.stopType === 'delivery');
  if (pickups.length === 0 || delivery === undefined) return null;
  const deliveryKg = delivery.extractedNetWeightKg;
  if (deliveryKg === null) return null;
  let pickupTotal = 0;
  for (const p of pickups) {
    const kg = p.extractedNetWeightKg;
    if (kg === null) return null;
    pickupTotal += kg;
  }
  return deliveryKg - pickupTotal;
}


/** Proof of capture for a stop: the committed manifest + a presigned GET URL.
 *  .strict(): this is the API-authored outgoing shape, validated server-side. */
export const StopProofSchema = z.object({
  manifestId: z.guid(),
  photoUrl: z.url(),
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
  extractionReason: z
    .enum(EXTRACTION_FAILURE_REASONS)
    .nullable()
    .optional(),
}).strict();
export type StopProof = z.infer<typeof StopProofSchema>;

/** One stop as the dispatch board sees it (API-authored outgoing shape, .strict()).
 *  proof === null => no committed photo yet (render arrival status); non-null =>
 *  render the "Phieu Can" link. */
export const DispatchStopViewSchema = z.object({
  stopId: z.guid(),
  sequence: z.number().int().positive(),
  stopType: z.enum(STOP_TYPES),
  warehouseName: z.union([z.string(), z.null()]),
  // Preserved from the pre-existing DispatchBoardStop shape (EXPAND-only): the
  // board still shows arrival/departure; proof is ADDED, nothing removed, so old
  // ops-web code stays valid.
  arrivedAt: z.union([z.iso.datetime(), z.null()]),
  departedAt: z.union([z.iso.datetime(), z.null()]),
  // proof === null => no committed manifest for this stop (render arrival status);
  // non-null => render the "Phieu Can" hyperlink to proof.photoUrl.
  proof: z.union([StopProofSchema, z.null()]),
}).strict();
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
 *  projection does not use it) — preserving the former non-strict loader shape. */
export const DispatchBoardStopSchema = z.object({
  sequence: z.number().int(),
  stopType: z.string(),
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
