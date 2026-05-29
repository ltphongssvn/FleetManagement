// packages/sync-protocol/src/index.ts
// Barrel export for @fleet/sync-protocol package.
// Named exports only — no `export *` to prevent namespace pollution.
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
