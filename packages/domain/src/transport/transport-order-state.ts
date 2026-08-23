// packages/domain/src/transport/transport-order-state.ts
// Transport order lifecycle state machine per Frozen Stack PDF "Domain model".
// transport_order_state is relational truth (PDF Day-One feature 3).
import { z } from 'zod';
import {
  createStateMachine,
  type FiniteStateMachine,
} from '../state-machines/finite-state-machine.js';

/**
 * Transport order lifecycle. Drives projection_status + sync_change_feed deltas.
 *
 * @see Frozen Stack PDF section "Domain model"
 */
// Tuple-first SSOT (2026 canonical for Drizzle + Zod): the vocabulary is
// declared ONCE as a frozen as-const tuple, and BOTH the Zod schema and the
// drizzle pgEnum derive from it. Declaration order matters: the tuple must
// precede the schema.
//
// Why not the previous shape (schema first, STATES = Object.freeze(
// TransportOrderStateSchema.options)): Zod types .options as
// ("draft" | "assigned" | ...)[] -- an ARRAY of the union, not a tuple -- and
// the readonly TransportOrderState[] annotation erased whatever literal
// structure remained. pgEnum requires Readonly<[U, ...U[]]>, so the SSOT was
// unusable at the DB layer. That is precisely why the arrays ended up
// hand-copied into apps/api database/schema/transport.ts: the duplication was
// the symptom, this type erasure was the cause. Removing the copy without
// fixing the erasure would put it straight back.
//
// Object.freeze is retained and costs nothing: Readonly<T> of a tuple IS that
// tuple, so runtime immutability and the literal types both survive.
export const TRANSPORT_ORDER_STATES = Object.freeze([
  'draft',
  'assigned',
  'in_transit',
  'completed',
  'cancelled',
] as const);
export const TransportOrderStateSchema = z.enum(TRANSPORT_ORDER_STATES);
export type TransportOrderState = z.infer<typeof TransportOrderStateSchema>;

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

// Derived non-terminal subset. SSOT is the FSM terminal declaration above;
// consumers (e.g. reference.service busy predicates) import this and must
// never hand-write the subset (two-axis rule, fix-trigger 2).
export const TRANSPORT_ORDER_NON_TERMINAL_STATES: readonly TransportOrderState[] = Object.freeze(
  TRANSPORT_ORDER_STATES.filter((s) => !transportOrderFsm.isTerminal(s)),
);
// Convenience re-exports for ergonomic call sites.
export const isTerminal = transportOrderFsm.isTerminal;
export const canTransition = transportOrderFsm.canTransition;
export const transitionTransportOrder = transportOrderFsm.transition;
