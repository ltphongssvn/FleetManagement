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
export {
  ExtractionFailureReasonSchema,
} from './extraction-vocabulary.js';
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
export * from './device-binding-contract.js';
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

// Vietnamese date PRESENTATION contract (2026). One locale, one timezone, one
// set of Intl options and one pair of Excel numFmt tokens for every surface
// that renders a date to a human. Machine keys (en-CA ISO grouping keys in
// owner-metrics / trip-history-grouping) are deliberately out of scope.
export {
  VN_LOCALE,
  VN_TIME_ZONE,
  VN_DATE_FALLBACK,
  VN_DATE_STYLES,
  vnDateStyleSchema,
  type VnDateStyle,
  VN_DATE_INTL_OPTIONS,
  VN_LONG_DAY_WORD,
  VN_LONG_MONTH_WORD,
  VN_LONG_YEAR_WORD,
  VN_EXCEL_DATE_NUMFMT,
  VN_EXCEL_DATETIME_NUMFMT,
  FORBIDDEN_UI_DATE_LOCALES,
  type ForbiddenUiDateLocale,
  isVnDateString,
  isVnDateTimeString,
  vnDateStringSchema,
  type VnDateString,
  vnDateTimeStringSchema,
  type VnDateTimeString,
} from './vn-date-format-contract.js';

// The formatters themselves. Every human-facing date in ops-web, api,
// driver-app and owner-app must come from these three functions rather than a
// locally constructed Intl.DateTimeFormat, so locale, timezone and field order
// can never drift apart again.
export {
  type VnDateInput,
  formatVnDate,
  formatVnDateTime,
  formatVnDateLong,
  // Field bridge for the app-owned Vietnamese date input that replaces the
  // native control, whose displayed format is browser-locale-owned and not
  // overridable from application code. The ISO value these produce is what
  // the existing wire schemas already expect, so no server contract moves.
  parseVnDateToIso,
  isoToVnDate,
} from './vn-date-format.js';
