// packages/sync-protocol/src/extraction-vocabulary.ts
// LEAF SSOT (no intra-package imports) for the phieu-can extraction FAILURE
// REASON vocabulary. Extracted here so BOTH extraction-types.ts (the wire
// result contract) and dispatch-stop-view-contract.ts (the board read model)
// import the ONE definition downward, with neither importing the other. That
// removes the import cycle that arises when two sibling contracts each need a
// value the other also owns (2026 idiom: hoist shared primitives to a leaf
// module rather than adding a back-edge).
//
// Deterministic cause of a non-extracted outcome, persisted so a specific
// failure is never collapsed into an undifferentiated 'unreadable':
//   unparseable          -> VLM read a field but the number would not parse.
//   below_sanity_min     -> parsed, but under the truck-scale floor.
//   above_sanity_max     -> parsed, but over the truck-scale ceiling.
//   no_field             -> no net-weight field on the ticket at all.
//   object_missing       -> the stored image object was absent.
//   multiple_slips       -> several tickets photographed together (T33).
//   non_standard_format  -> a layout outside the three standard formats (T33).
import { z } from 'zod';

export const EXTRACTION_FAILURE_REASONS = [
  'unparseable',
  'below_sanity_min',
  'above_sanity_max',
  'no_field',
  'object_missing',
  'multiple_slips',
  'non_standard_format',
] as const;

export const ExtractionFailureReasonSchema = z.enum(EXTRACTION_FAILURE_REASONS);

export type ExtractionFailureReason = typeof EXTRACTION_FAILURE_REASONS[number];
