// packages/sync-protocol/src/manifest-stop-contract.ts
// Zod-first, contract-first (2026): the SINGLE SOURCE OF TRUTH for associating a
// proof-photo manifest with the specific STOP it was captured at. Shared by
// driver-app (capture), API (persist + serve), and ops-web (render "Phiếu Cân").
//
// WHY THIS EXISTS: the manifest table links only to transport_order_id, so today
// a committed photo cannot be mapped to a stop. Per the weak-entity model a stop
// is identified by (transportOrderId, sequence); we also carry the stop_id when
// known. Capture-time tagging is the only reliable association (back-filling
// existing photos is lossy), so the reference is supplied on /upload/negotiate.
import { z } from 'zod';

/** Reference to the stop a manifest documents. Both forms are accepted; the API
 *  resolves/validates them against the stop table. sequence is 1-based per the
 *  stop.sequence column; stopId is the stop PK when the client already has it. */
export const ManifestStopRefSchema = z.object({
  stopId: z.union([z.guid(), z.null()]),
  stopSequence: z.union([z.number().int().positive(), z.null()]),
}).strict().refine(
  (v) => v.stopId !== null || v.stopSequence !== null,
  { message: 'at least one of stopId or stopSequence is required' },
);
export type ManifestStopRef = z.infer<typeof ManifestStopRefSchema>;
