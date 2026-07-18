// packages/domain/src/index.ts
// Barrel export for @fleet/domain package.
export { type MutationLockState, MUTATION_LOCK_STATES } from './state-machines/mutation-lock.js';
export {
  type FiniteStateMachine,
  type FsmDefinition,
  type TransitionResult,
  type TransitionFailureReason,
  createStateMachine,
} from './state-machines/finite-state-machine.js';
export {
  type SessionSurface,
  SessionSurfaceSchema,
  SESSION_SURFACES,
  type SessionMode,
  SessionModeSchema,
  SESSION_MODES,
  type RevocationReason,
  RevocationReasonSchema,
  REVOCATION_REASONS,
  REVOCATION_REASON_SCHEMA_VERSION,
  type RevocationEvent,
  RevocationEventSchema,
  type OperatorContext,
} from './identity/index.js';
export {
  type TransportOrderState,
  TransportOrderStateSchema,
  TRANSPORT_ORDER_STATES,
  TRANSPORT_ORDER_NON_TERMINAL_STATES,
  transportOrderFsm,
  isTerminal,
  canTransition,
  transitionTransportOrder,
  type RoadRunState,
  RoadRunStateSchema,
  ROAD_RUN_STATES,
  ROAD_RUN_NON_TERMINAL_STATES,
  roadRunFsm,
  isRoadRunTerminal,
  canTransitionRoadRun,
  transitionRoadRun,
  ROAD_RUN_STATE_TONE,
  groupCompletedTripsByMonth,
  type TripMonthGroup,
  type CancelReason,
  CancelReasonSchema,
  CANCEL_REASONS,
} from './transport/index.js';
export {
  UPLOAD_SESSION_STATES,
  UPLOAD_SESSION_COMMITTABLE_STATES,
  UPLOAD_SESSION_FINALIZABLE_STATES,
  MANIFEST_STATES,
  MANIFEST_VERIFIABLE_STATES,
  MANIFEST_FINALIZABLE_STATES,
  type UploadSessionState,
  type ManifestState,
} from './manifest/manifest-state.js';
export {
  MANIFEST_REJECTION_REASONS,
  ManifestRejectionReasonSchema,
  type ManifestRejectionReason,
} from './manifest/manifest-rejection-reason.js';
export * from "./number-format/parse-one-number.js";
export * from './manifest/manifest-extraction-status.js';
export {
  ROLLOUT_VERDICTS,
  RolloutVerdictSchema,
  type RolloutVerdict,
} from './delivery/rollout-verdict.js';
export {
  DEFAULT_ROLLOUT_LADDER,
  RolloutStageSchema,
  RolloutLadderSchema,
  type RolloutStage,
  type RolloutLadder,
} from './delivery/rollout-stage.js';
export {
  DEFAULT_GUARDRAILS,
  DEFAULT_FAILURE_LIMIT,
  GuardrailSchema,
  GuardrailSetSchema,
  type Guardrail,
  type GuardrailSet,
} from './delivery/rollout-guardrail.js';
export {
  MetricSampleSchema,
  RolloutMetricsSchema,
  type MetricSample,
  type RolloutMetrics,
} from './delivery/rollout-metrics.js';
export {
  RolloutAllocationSchema,
  type RolloutAllocation,
} from './delivery/rollout-allocation.js';
export { bucketFor, isTenantExposed } from './delivery/rollout-bucket.js';
