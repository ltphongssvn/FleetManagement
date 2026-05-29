// packages/domain/src/transport/road-run-state.ts
// Road-run execution state per PDF "execution split road_run + rail_run".
import { z } from 'zod';
import { createStateMachine, type FiniteStateMachine } from '../state-machines/finite-state-machine.js';

/**
 * Road run lifecycle. Decoupled from transport_order_state to allow a single
 * road_run to carry multiple transport_orders (multi-stop).
 *
 * @see Frozen Stack PDF section "Domain model"
 */
export const RoadRunStateSchema = z.enum([
  'planned',
  'dispatched',
  'started',
  'completed',
  'cancelled',
]);
export type RoadRunState = z.infer<typeof RoadRunStateSchema>;
export const ROAD_RUN_STATES: readonly RoadRunState[] = Object.freeze(RoadRunStateSchema.options);

export const roadRunFsm: FiniteStateMachine<RoadRunState> = createStateMachine({
  version: 1,
  states: ROAD_RUN_STATES,
  terminal: ['completed', 'cancelled'],
  transitions: new Map<RoadRunState, ReadonlySet<RoadRunState>>([
    ['planned', new Set(['dispatched', 'cancelled'])],
    ['dispatched', new Set(['started', 'cancelled'])],
    ['started', new Set(['completed', 'cancelled'])],
    ['completed', new Set()],
    ['cancelled', new Set()],
  ]),
});

export const isRoadRunTerminal = roadRunFsm.isTerminal;
export const canTransitionRoadRun = roadRunFsm.canTransition;
export const transitionRoadRun = roadRunFsm.transition;
