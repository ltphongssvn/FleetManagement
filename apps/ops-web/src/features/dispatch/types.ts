// apps/ops-web/src/features/dispatch/types.ts
// Dispatch view types. The board row + stop shapes AND the assigned-orders /
// review row shape are all SINGLE-SOURCE-OF-TRUTH canonical Zod schemas in
// @fleet/sync-protocol; this module re-exports their inferred types under the
// ops-web-domain names used across the dispatch feature (one road_run == one
// board row). No shape is re-declared here — there is exactly one definition,
// in the contract package, that the API and ops-web both derive from.
//
// P0-#2 (2026): ListAssignedRow + ListAssignedRowStop were previously
// hand-written here, duplicating the API DTO, and the review page cast its BFF
// response 'as ListAssignedRow'. Both now derive from ListAssignedRowSchema in
// the contract package; the review page parses at its trust boundary.
export type {
  StopProof,
  DispatchBoardStop,
  DispatchBoardRow as DispatchBoardRoadRun,
  ListAssignedRowStop,
  ListAssignedRow,
} from '@fleet/sync-protocol';
