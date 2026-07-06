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
  NegotiateUploadResponseSchema,
  type NegotiateUploadResponse,
  CommitUploadResponseSchema,
  type CommitUploadResponse,
} from './manifest-response-contract.js';
export {
  STOP_TYPES,
  type StopType,
  netWeightKgSchema,
  type NetWeightKg,
  weightDiffKgSchema,
  type WeightDiffKg,
  WeightDiffStopSchema,
  type WeightDiffStop,
  computeWeightDiffKg,
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
  ROAD_RUN_STATES,
  type RoadRunStateName,
} from './dispatch-stop-view-contract.js';
export {
  ListAssignedRowStopSchema,
  type ListAssignedRowStop,
  ListAssignedRowSchema,
  type ListAssignedRow,
  ListAssignedResponseSchema,
  type ListAssignedResponse,
  TripHistoryMonthSchema,
  type TripHistoryMonth,
  TripHistoryResponseSchema,
  type TripHistoryResponse,
} from './list-assigned-contract.js';
export {
  CommandTypeSchema,
  type CommandType,
  CommandPayloadSchema,
  type CommandPayload,
  AckRejectionReasonSchema,
  type AckRejectionReason,
  CommandAckSchema,
  type CommandAck,
} from './command-contract.js';
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
  ROAD_RUN_STATUS_GROUPS,
  roadRunStatusGroupSchema,
  type RoadRunStatusGroup,
  statesForStatusGroup,
  ROAD_RUN_PAGE_SIZE_MAX,
  ROAD_RUN_PAGE_SIZE_DEFAULT,
  RoadRunPageQuerySchema,
  type RoadRunPageQuery,
  makePaginatedResponseSchema,
  DispatchBoardPageApiResponseSchema,
  type DispatchBoardPageApiResponse,
  DispatchBoardPageResponseSchema,
  type DispatchBoardPageResponse,
} from './dispatch-board-pagination-contract.js';
export {
  DriverCompletedPageQuerySchema,
  type DriverCompletedPageQuery,
  DriverCompletedPageResponseSchema,
  type DriverCompletedPageResponse,
} from './driver-orders-pagination-contract.js';
export {
  ExtractionJobDataWireSchema,
  EXTRACTION_STATUSES,
  ExtractionResultWireSchema,
  type ExtractionJobDataWire,
  type ExtractionStatus,
  type ExtractionResultWire,
} from './extraction-types.js';
export {
  exportDayKeySchema,
  type ExportDayKey,
  ExportDateRangeSchema,
  type ExportDateRange,
} from './transport-order-export-contract.js';

export {
  EXPORT_PICKUP_SLOTS,
  EXPORT_DELIVERY_SLOTS,
  EXPORT_KG_SUFFIX,
  EXPORT_IDENTIFYING_HEADERS,
  LENH_DIEU_XE_EXPORT_HEADERS,
} from './transport-order-export-headers.js';
export {
  FLEET_ERROR_CODES,
  FleetErrorCodeSchema,
  type FleetErrorCode,
  ProblemDetailsSchema,
  parseProblemDetails,
  PROBLEM_DETAILS_CONTENT_TYPE,
  type ProblemDetails,
} from './problem-details-contract.js';

export {
  KeycloakEventDetailsSchema,
  type KeycloakEventDetails,
  KeycloakLoginEventSchema,
  type KeycloakLoginEvent,
} from './keycloak-event-types.js';
export {
  DRIVER_ATTENTION_REASONS,
  DriverAttentionReasonSchema,
  AdminDriverDeviceSchema,
  AdminDriverVehicleSchema,
  AdminDriverRowSchema,
  AdminDriverRowsSchema,
  parseAdminDriverRows,
  classifyDriverAttention,
  needsDriverAttention,
  type DriverAttentionReason,
  type AdminDriverDevice,
  type AdminDriverVehicle,
  type AdminDriverRow,
  type DriverAttentionFacts,
} from './driver-attention-contract.js';

export {
  ReferenceItemSchema,
  type ReferenceItem,
  ReferenceListResponseSchema,
  type ReferenceListResponse,
  DriverVehicleAssignmentItemSchema,
  type DriverVehicleAssignmentItem,
  DriverVehicleAssignmentsResponseSchema,
  type DriverVehicleAssignmentsResponse,
  PeekOrderRefResponseSchema,
  type PeekOrderRefResponse,
} from './reference-contract.js';
