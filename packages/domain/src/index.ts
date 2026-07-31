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
  normalizeDisplayName,
  personNameMatchKey,
  DriverNameSchema,
  type DriverName,
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
  type CancelOrderInput,
  CancelOrderInputSchema,
} from './transport/index.js';
export {
  UPLOAD_SESSION_STATES,
  UPLOAD_SESSION_COMMITTABLE_STATES,
  UPLOAD_SESSION_FINALIZABLE_STATES,
  MANIFEST_STATES,
  MANIFEST_VERIFIABLE_STATES,
  MANIFEST_FINALIZABLE_STATES,
  MANIFEST_PHOTO_RECEIVED_STATES,
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

// T33: phieu-can STANDARD FORMAT SSOT + the pure goods-kg derivation rule.
// Exported from the barrel because every consumer (worker extraction policy,
// api manifest service, ops-web board) imports from the package ROOT; a deep
// src path import is what invites a downstream re-declaration of the vocabulary.
export {
  PHIEU_CAN_FORMATS,
  PhieuCanFormatSchema,
  type PhieuCanFormat,
  GOODS_DERIVATION_REFUSALS,
  GoodsDerivationRefusalSchema,
  type GoodsDerivationRefusal,
  type PhieuCanWeights,
  type GoodsDerivation,
  deriveGoodsKg,
} from './manifest/phieu-can-format.js';

// T70: UI AFFORDANCE SSOT -- tone, emphasis, empty-state reason, help topic and
// the WCAG 2.5.8 target-size floor. Exported from the barrel because every
// consumer (ops-web primitives, driver-app, owner-app) imports from the package
// ROOT; a deep src path import is precisely what invites a screen to re-declare
// its own one-off tone union and reopen the drift this arc closes.
export {
  ACTION_TONES,
  ActionToneSchema,
  type ActionTone,
  ACTION_EMPHASES,
  ActionEmphasisSchema,
  type ActionEmphasis,
  EMPTY_STATE_REASONS,
  EmptyStateReasonSchema,
  type EmptyStateReason,
  type EmptyStateCopy,
  EMPTY_STATE_VI,
  HELP_TOPICS,
  HelpTopicSchema,
  type HelpTopic,
  type HelpTopicCopy,
  HELP_TOPIC_VI,
  MIN_TARGET_SIZE_PX,
} from './ui/affordance.js';
