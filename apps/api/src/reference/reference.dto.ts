// apps/api/src/reference/reference.dto.ts
// Reference list wire shapes now DERIVE from the @fleet/sync-protocol SSOT
// (reference-contract.ts) instead of a hand-written local twin -- one of the
// four duplicated definitions consolidated by the schema-first arc. Re-export
// keeps the api-local names stable for the controller/service signatures.
export type {
  ReferenceItem,
  ReferenceListResponse,
} from '@fleet/sync-protocol';
