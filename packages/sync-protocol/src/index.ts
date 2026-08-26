// packages/sync-protocol/src/index.ts
// Barrel export for @fleet/sync-protocol package.
// Named exports only (no wildcard re-export) to prevent namespace pollution.
export {
  type SyncStatus,
  SYNC_STATUSES,
  type SyncActionResult,
  SYNC_ACTION_RESULTS,
  type SyncResponse,
} from './sync-types.js';
export {
  ActionIdSchema,
  type ActionId,
  AggregateIdSchema,
  type AggregateId,
  SyncCursorSchema,
  type SyncCursor,
  ManifestCorrelationIdSchema,
  type ManifestCorrelationId,
  createActionId,
  createAggregateId,
  createSyncCursor,
  SyncActionSchema,
  type SyncAction,
  type SyncActionInput,
  SyncRequestSchema,
  type SyncRequest,
  type SyncRequestInput,
} from './sync-contract.js';
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
  MappedErpPayloadSchema,
  type MappedErpPayload,
} from './erp-types.js';
export { type IntakeJobDataWire, IntakeJobDataWireSchema } from './intake-types.js';
export { ManifestStopRefSchema, type ManifestStopRef } from './manifest-stop-contract.js';
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
// Admin order-timeline read model. Named, not wildcard: line 3 of this file
// forbids wildcards, and a wildcard also defeats the analysis that keeps this
// barrel honest -- it republishes whatever the module happens to export, so the
// barrel stops being the authority on the public surface and every bundler and
// dead-code tool has to guess. Measured cost of the star form in 2026 barrel
// benchmarks is a large server-side bundle penalty; the correctness cost here is
// that a new internal helper becomes public by accident.
export {
  OrderTimelineEventSchema,
  type OrderTimelineEvent,
  OrderTimelineSchema,
  type OrderTimeline,
} from './order-timeline-contract.js';
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
  EXTRACTION_FAILURE_REASONS,
  ExtractionResultWireSchema,
  type ExtractionJobDataWire,
  type ExtractionStatus,
  type ExtractionFailureReason,
  type ExtractionResultWire,
} from './extraction-types.js';

// Leaf SSOT for the failure-reason vocabulary (extracted to break the
// extraction-types <-> dispatch-stop-view import cycle). The array + type are
// already re-exported above via extraction-types; the Zod SCHEMA is exported
// here for boundary validators (api/ops-web) that parse a reason value.
export { ExtractionFailureReasonSchema } from './extraction-vocabulary.js';

// Leaf SSOT for what a Phieu Can PROOF URL may be. Exported from the barrel
// because the value crosses a rendering boundary: ops-web parses it off the
// network and puts it straight into an anchor href, so every surface that
// produces or consumes a proof link must agree on the scheme allowlist. A deep
// src path import is what invites a second, weaker definition -- and the weaker
// definition here is a bare z.url(), which Zod documents as permissive enough to
// accept javascript: and data:.
export { PROOF_URL_PROTOCOL, ProofUrlSchema, type ProofUrl } from './proof-url.js';
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
  EXPORT_PICKUP_LABEL_PREFIX,
  EXPORT_DELIVERY_LABEL_PREFIX,
  exportPickupLabel,
  exportDeliveryLabel,
  EXPORT_IDENTIFYING_HEADERS,
  LENH_DIEU_XE_EXPORT_HEADERS,
} from './transport-order-export-headers.js';
export {
  BOARD_SEARCH_PREDICATES,
  type BoardSearchPredicate,
  BoardSearchColumnSchema,
  type BoardSearchColumn,
  BOARD_SEARCH_COLUMNS,
  boardSearchNameHeaders,
  boardSearchableColumns,
} from './board-search-contract.js';
export {
  FLEET_ERROR_CODES,
  FleetErrorCodeSchema,
  type FleetErrorCode,
  ProblemDetailsSchema,
  parseProblemDetails,
  InvalidStateTransitionExtensionsSchema,
  parseInvalidStateTransitionExtensions,
  type InvalidStateTransitionExtensions,
  ManifestsIncompleteExtensionsSchema,
  parseManifestsIncompleteExtensions,
  type ManifestsIncompleteExtensions,
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
export {
  OwnerAdoptionMetricsSchema,
  type OwnerAdoptionMetrics,
  parseOwnerAdoptionMetrics,
} from './owner-adoption-contract.js';

export {
  DriverLoginRequestSchema,
  type DriverLoginRequest,
  DriverLoginResponseSchema,
  type DriverLoginResponse,
  RefreshRequestSchema,
  type RefreshRequest,
  RefreshResponseSchema,
  type RefreshResponse,
  parseDriverLoginResponse,
  parseRefreshResponse,
} from './auth-contract.js';
export {
  COPILOT_COMMAND_TYPES,
  type CopilotCommandType,
  CopilotIdSpaceSchema,
  type CopilotIdSpace,
  CopilotEntityRefSchema,
  type CopilotEntityRef,
  CopilotCommandSchema,
  type CopilotCommand,
  CopilotPlanSchema,
  type CopilotPlan,
  CopilotPlanResponseSchema,
  type CopilotPlanResponse,
  CopilotExecutionResultSchema,
  type CopilotExecutionResult,
  normalizePlate,
  parseCopilotPlan,
  parseCopilotPlanResponse,
  parseCopilotExecutionResult,
} from './copilot-types.js';

// Device binding (installation identity + TOFU binding lifecycle).
// Named for the same reason as the timeline contract above. This module is the
// larger of the two wildcards and the one where the accident was most likely:
// it defines InstallationIdSchema as a MODULE-PRIVATE const, and a reader
// skimming a wildcard cannot tell which symbols are contract and which are
// scaffolding.
export {
  DeviceBindingPlatformSchema,
  type DeviceBindingPlatform,
  DeviceIdentitySchema,
  type DeviceIdentity,
  DeviceBindingStatusSchema,
  type DeviceBindingStatus,
  ATTESTATION_SECURITY_LEVELS,
  AttestationSecurityLevelSchema,
  type AttestationSecurityLevel,
  ATTESTATION_ENVIRONMENTS,
  AttestationEnvironmentSchema,
  type AttestationEnvironment,
  DeviceEnrollRequestSchema,
  type DeviceEnrollRequest,
  DeviceEnrollResponseSchema,
  type DeviceEnrollResponse,
  DEVICE_BINDING_PROBLEM_CODES,
  type DeviceBindingProblemCode,
  DEVICE_BINDING_ACTIONS,
  DeviceBindingActionSchema,
  type DeviceBindingAction,
  DEVICE_BINDING_ENFORCEMENT_MODES,
  DeviceBindingEnforcementModeSchema,
  type DeviceBindingEnforcementMode,
  DeviceBindingPatchRequestSchema,
  type DeviceBindingPatchRequest,
  AdminDeviceRowSchema,
  type AdminDeviceRow,
  parseDeviceEnrollRequest,
  parseDeviceEnrollResponse,
  ADMIN_DEVICE_PAGE_SIZE_MAX,
  ADMIN_DEVICE_PAGE_SIZE_DEFAULT,
  AdminDeviceListQuerySchema,
  type AdminDeviceListQuery,
  AdminDeviceListResponseSchema,
  type AdminDeviceListResponse,
} from './device-binding-contract.js';
export {
  DRIVER_ALERT_KINDS,
  DriverAlertKindSchema,
  type DriverAlertKind,
  DriverAlertJobSchema,
  type DriverAlertJob,
  DriverAlertPushDataSchema,
  type DriverAlertPushData,
  DRIVER_ALERT_ANDROID_CHANNEL_ID,
  DRIVER_ALERT_SOUND,
  DRIVER_ALERT_VIBRATION_PATTERN,
} from './driver-alert-contract.js';
export {
  DRIVER_DB_STATUSES,
  driverDbStatusSchema,
  type DriverDbStatus,
  DRIVER_DB_STATUS_PLACEHOLDER_APP_VERSION,
  type DriverDbStatusFacts,
  classifyDriverDbStatus,
} from './co-so-du-lieu-contract.js';

// Dispatched-vs-idle driver roster split for the Bang dieu phoi xe owner panel.
// Exported from the barrel because every consumer (api service, ops-web loader,
// panel component, E2E) imports from the package ROOT; a deep src path import
// is what invites a downstream re-declaration of the partition rule.
export {
  IDLE_REASONS,
  IdleReasonSchema,
  type IdleReason,
  DispatchedDriverRowSchema,
  type DispatchedDriverRow,
  IdleDriverRowSchema,
  type IdleDriverRow,
  DispatchRosterSplitSchema,
  type DispatchRosterSplit,
  parseDispatchRosterSplit,
  isRosterPartitionValid,
} from './dispatch-roster-split-contract.js';

// Build-provenance contract: what a deployed service reports about ITSELF.
// Exported from the barrel because all four consumers import from the package
// ROOT -- the api health controller, the ops-web version route, the worker boot
// heartbeat, and the CI gate that parses the payload. A deep src path import is
// what invites a second, drifting definition of the shape CI asserts against.
export {
  UNKNOWN_VERSION_FIELD,
  WORKER_PROVENANCE_KEY,
  WORKER_PROVENANCE_TTL_SECONDS,
  WORKER_PROVENANCE_REFRESH_SECONDS,
  DeployVersionSchema,
  type DeployVersion,
  type ProvenanceEnv,
  buildDeployVersion,
} from './deploy-version-contract.js';
