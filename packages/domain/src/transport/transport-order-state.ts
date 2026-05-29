// packages/domain/src/transport/transport-order-state.ts
// Transport order lifecycle state machine per Frozen Stack PDF "Domain model".
// transport_order_state is relational truth (PDF Day-One feature 3).
import { z } from 'zod';
import { createStateMachine, type FiniteStateMachine } from '../state-machines/finite-state-machine.js';

/**
 * Transport order lifecycle. Drives projection_status + sync_change_feed deltas.
 *
 * @see Frozen Stack PDF section "Domain model"
 */
export const TransportOrderStateSchema = z.enum([
  'draft',
  'assigned',
  'in_transit',
  'completed',
  'cancelled',
]);
export type TransportOrderState = z.infer<typeof TransportOrderStateSchema>;
export const TRANSPORT_ORDER_STATES: readonly TransportOrderState[] = Object.freeze(
  TransportOrderStateSchema.options,
);

export const transportOrderFsm: FiniteStateMachine<TransportOrderState> = createStateMachine({
  version: 1,
  states: TRANSPORT_ORDER_STATES,
  terminal: ['completed', 'cancelled'],
  transitions: new Map<TransportOrderState, ReadonlySet<TransportOrderState>>([
    ['draft', new Set(['assigned', 'cancelled'])],
    ['assigned', new Set(['in_transit', 'cancelled'])],
    ['in_transit', new Set(['completed', 'cancelled'])],
    ['completed', new Set()],
    ['cancelled', new Set()],
  ]),
});

// Convenience re-exports for ergonomic call sites.
export const isTerminal = transportOrderFsm.isTerminal;
export const canTransition = transportOrderFsm.canTransition;
export const transitionTransportOrder = transportOrderFsm.transition;
