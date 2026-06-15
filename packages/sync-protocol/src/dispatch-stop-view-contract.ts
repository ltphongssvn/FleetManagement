// packages/sync-protocol/src/dispatch-stop-view-contract.ts
// Zod-first read-model contract (2026 contract-first): the SINGLE SOURCE OF TRUTH
// for what ops-web renders per stop on the dispatch board. The API validates its
// OUTGOING response against this (dev-time response validation guards drift);
// ops-web parses the same schema so the UI and server cannot diverge.
//
// Per stop, proof is non-null once a committed manifest is associated with that
// stop -> ops-web renders a "Phiếu Cân" hyperlink to proof.photoUrl; otherwise it
// shows the arrival status. photoUrl is a short-lived presigned S3 GET URL minted
// by the API (never a raw bucket path), so the private bucket is never exposed.
import { z } from 'zod';

export const STOP_TYPES = ['pickup', 'delivery'] as const;
export type StopType = typeof STOP_TYPES[number];

/** Proof of capture for a stop: the committed manifest + a presigned GET URL. */
export const StopProofSchema = z.object({
  manifestId: z.string().uuid(),
  photoUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  // EXPAND-only (phieu-can net-weight extraction): net goods weight in kg parsed
  // from the committed Phieu Can by the extraction worker. optional => old
  // producers omitting the key stay valid; null => extraction pending/failed;
  // positive number => render kg next to the Phieu Can link.
  extractedNetWeightKg: z.union([z.number().positive(), z.null()]).optional(),
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
    .enum(['unparseable', 'below_sanity_min', 'above_sanity_max', 'no_field', 'object_missing'])
    .nullable()
    .optional(),
}).strict();
export type StopProof = z.infer<typeof StopProofSchema>;

/** One stop as the dispatch board sees it. proof === null => no committed photo
 *  yet (render arrival status); non-null => render the "Phiếu Cân" link. */
export const DispatchStopViewSchema = z.object({
  stopId: z.string().uuid(),
  sequence: z.number().int().positive(),
  stopType: z.enum(STOP_TYPES),
  warehouseName: z.union([z.string(), z.null()]),
  // Preserved from the pre-existing DispatchBoardStop shape (EXPAND-only): the
  // board still shows arrival/departure; proof is ADDED, nothing removed, so old
  // ops-web code stays valid.
  arrivedAt: z.union([z.string().datetime(), z.null()]),
  departedAt: z.union([z.string().datetime(), z.null()]),
  // proof === null => no committed manifest for this stop (render arrival status);
  // non-null => render the "Phiếu Cân" hyperlink to proof.photoUrl.
  proof: z.union([StopProofSchema, z.null()]),
}).strict();
export type DispatchStopView = z.infer<typeof DispatchStopViewSchema>;

/** The board row for one road_run/order: ordered stops + the run state. */
export const DispatchOrderViewSchema = z.object({
  roadRunId: z.string().uuid(),
  orderReference: z.string().min(1),
  roadRunState: z.string().min(1),
  stops: z.array(DispatchStopViewSchema),
}).strict();
export type DispatchOrderView = z.infer<typeof DispatchOrderViewSchema>;
