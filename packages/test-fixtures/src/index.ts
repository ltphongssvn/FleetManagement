// packages/test-fixtures/src/index.ts
// Barrel export for @fleet/test-fixtures package.
// Factories and seed data for TDD across the monorepo.
export {
  createMockSyncRequest,
  createMockSyncResponse,
  createMockSyncAction,
} from './sync-fixtures.js';

export {
  createOperatorContext,
  createSyncAction,
  type OperatorContextLike,
  type SyncActionLike,
} from './operator-fixtures.js';

export {
  createCommandPayload,
  createNegotiateUploadInput,
  createCommitUploadInput,
  createCreateTransportOrderInput,
  type CommandPayloadLike,
  type NegotiateUploadInputLike,
  type CommitUploadInputLike,
  type CreateTransportOrderInputLike,
  type StopLike,
} from './payload-fixtures.js';

export {
  createPgUniqueViolation,
  createWrappedError,
} from './pg-error-fixtures.js';

// Build-provenance fixtures. A commit sha hand-written as a readable literal
// is not a sha, and a suite asserting against one proves nothing -- see
// provenance-fixtures.ts for the defect this removes.
export {
  testSha,
  testShortSha,
  INVALID_SHA_FIXTURES,
} from './provenance-fixtures.js';
