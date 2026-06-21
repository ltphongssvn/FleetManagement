// packages/sync-protocol/src/index.ts
// Barrel export for @fleet/sync-protocol package.
// Named exports only (no wildcard re-export) to prevent namespace pollution.
export {
  type ActionId,
  type SyncCursor,
  type AggregateId,
  type ManifestCorrelationId,
  createActionId,
  createSyncCursor,
  createAggregateId,
  type SyncStatus,
  SYNC_STATUSES,
  type SyncActionResult,
  SYNC_ACTION_RESULTS,
  type SyncAction,
  type SyncRequest,
  type SyncResponse,
} from './sync-types.js';
export {
  ALLOWED_MANIFEST_MIME_TYPES,
  type ManifestMimeType,
  MANIFEST_MAX_SIZE_BYTES,
} from './manifest-types.js';
export {
  PILOT_CURRENCIES,
  PILOT_CURRENCY_SET,
  ERP_AMOUNT_CENTS_MAX,
  type PilotCurrency,
  type ErpInvoicePayloadWire,
  type ErpMappingContextWire,
  type ErpJobDataWire,
  ErpInvoicePayloadWireSchema,
  ErpMappingContextWireSchema,
  ErpJobDataWireSchema,
} from './erp-types.js';
export {
  type IntakeJobDataWire,
  IntakeJobDataWireSchema,
} from './intake-types.js';
export {
  ManifestStopRefSchema,
  type ManifestStopRef,
} from './manifest-stop-contract.js';
export {
  STOP_TYPES,
  type StopType,
  netWeightKgSchema,
  type NetWeightKg,
  StopProofSchema,
  type StopProof,
  DispatchStopViewSchema,
  type DispatchStopView,
  DispatchBoardStopSchema,
  type DispatchBoardStop,
  DispatchBoardRowSchema,
  type DispatchBoardRow,
  DispatchBoardResponseSchema,
  type DispatchBoardResponse,
  DispatchBoardApiRowSchema,
  type DispatchBoardApiRow,
  DispatchBoardApiResponseSchema,
  type DispatchBoardApiResponse,
} from './dispatch-stop-view-contract.js';
export {
  OUTBOX_ROUTING_POLICY_VERSION,
  routeOutboxRow,
  type OutboxRoutingInput,
  type OutboxRoutingDecision,
  type OutboxRoutingRejectionCode,
  type OutboxTargetQueue,
  OUTBOX_QUEUES,
  type OutboxQueueName,
} from './outbox-routing.js';
export { COMMAND_EVENTS, type CommandEventName } from './command-events.js';
export * from './order-timeline-contract.js';
export {
  ExtractionJobDataWireSchema,
  EXTRACTION_STATUSES,
  ExtractionResultWireSchema,
  type ExtractionJobDataWire,
  type ExtractionStatus,
  type ExtractionResultWire,
} from './extraction-types.js';
