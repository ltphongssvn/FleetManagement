// packages/domain/src/manifest/manifest-extraction-status.ts
// SSOT for a manifest's phieu-can net-weight extraction status — the single
// vocabulary shared by persistence (manifest.extraction_status), the API
// (manual-edit + worker callback), and the ops-web board so the four UI states
// are distinguishable instead of all collapsing to a blank link:
//   pending    -> enqueued / not yet processed (default). UI: "processing".
//   extracted  -> VLM read a net-weight field. UI: show kg.
//   not_found  -> VLM found no net-weight field. UI: "needs entry".
//   unreadable -> VLM read a field but it failed to parse. UI: "needs entry".
//   manual     -> a human entered the kg via the board. UI: show kg (manual).
// The three middle values are exactly the wire EXTRACTION_STATUSES emitted by
// the worker; 'pending' (default) and 'manual' (human) are persistence-only.
import { z } from 'zod';

export const MANIFEST_EXTRACTION_STATUSES = [
  'pending',
  'extracted',
  'not_found',
  'unreadable',
  'manual',
] as const;

export const manifestExtractionStatusSchema = z.enum(MANIFEST_EXTRACTION_STATUSES);

export type ManifestExtractionStatus = z.infer<typeof manifestExtractionStatusSchema>;

// Terminal = extraction will not change this on its own (the worker is done, or
// a human has set it). Only 'pending' is non-terminal. Used by the UI to decide
// "processing" (pending) vs a settled state, and by the API to know whether a
// re-extraction is still expected. Note terminality says nothing about whether a
// value is present — not_found/unreadable are terminal but value-less.
export function isTerminalExtractionStatus(status: ManifestExtractionStatus): boolean {
  return status !== 'pending';
}
