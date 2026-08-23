// packages/domain/src/transport/index.ts
export {
  type TransportOrderState,
  TransportOrderStateSchema,
  TRANSPORT_ORDER_STATES,
  TRANSPORT_ORDER_NON_TERMINAL_STATES,
  transportOrderFsm,
  isTerminal,
  canTransition,
  transitionTransportOrder,
} from './transport-order-state.js';
export {
  type RoadRunState,
  RoadRunStateSchema,
  ROAD_RUN_STATES,
  ROAD_RUN_NON_TERMINAL_STATES,
  roadRunFsm,
  isRoadRunTerminal,
  canTransitionRoadRun,
  transitionRoadRun,
} from './road-run-state.js';
export { ROAD_RUN_STATE_TONE } from './road-run-presentation.js';
export { groupCompletedTripsByMonth, type TripMonthGroup } from './trip-history-grouping.js';
// SSOT for what TODAY means (Asia/Ho_Chi_Minh calendar day + its UTC window).
// Named explicitly: this barrel does not wildcard, so an omitted symbol
// silently disappears from dist and every consumer breaks at import time.
export { VN_TIME_ZONE, vnDayOf, vnDayWindowUtc, type VnDayWindow } from './vn-day-window.js';
export { type CancelReason, CancelReasonSchema, CANCEL_REASONS } from './cancel-reason.js';
export { type CancelOrderInput, CancelOrderInputSchema } from './cancel-order-input.js';
