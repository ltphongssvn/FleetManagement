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
  transportOrderFsm,
  isTerminal,
  canTransition,
  transitionTransportOrder,
  type RoadRunState,
  RoadRunStateSchema,
  ROAD_RUN_STATES,
  roadRunFsm,
  isRoadRunTerminal,
  canTransitionRoadRun,
  transitionRoadRun,
  ROAD_RUN_STATE_TONE,
} from './transport/index.js';
