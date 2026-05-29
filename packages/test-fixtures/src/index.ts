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
