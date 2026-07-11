// packages/domain/test/transport-non-terminal-states.test.ts
// RED-first (T9 ghost-run arc, 2026-07-10): derived non-terminal state
// subsets for transport_order and road_run. Two-axis rule fix-trigger 2:
// apps/api reference.service hand-writes ROAD_RUN_NON_TERMINAL_STATES
// locally, and the ghost-run GREEN fix needs the transport-order sibling.
// Both subsets must DERIVE from the FSMs single terminal declaration
// (filter through isTerminal) -- never hand-written a second time.
import { describe, it, expect } from 'vitest';
import {
  TRANSPORT_ORDER_STATES,
  TRANSPORT_ORDER_NON_TERMINAL_STATES,
  isTerminal,
  ROAD_RUN_STATES,
  ROAD_RUN_NON_TERMINAL_STATES,
  isRoadRunTerminal,
} from '../src/index.js';
describe('@fleet/domain - TRANSPORT_ORDER_NON_TERMINAL_STATES', () => {
  it('derives exactly the FSM non-terminal subset in canonical order', () => {
    expect([...TRANSPORT_ORDER_NON_TERMINAL_STATES]).toEqual(
      TRANSPORT_ORDER_STATES.filter((s) => !isTerminal(s)),
    );
  });
  it('matches the canonical literal subset', () => {
    expect([...TRANSPORT_ORDER_NON_TERMINAL_STATES]).toEqual(['draft', 'assigned', 'in_transit']);
  });
  it('is frozen', () => {
    expect(Object.isFrozen(TRANSPORT_ORDER_NON_TERMINAL_STATES)).toBe(true);
  });
});
describe('@fleet/domain - ROAD_RUN_NON_TERMINAL_STATES', () => {
  it('derives exactly the FSM non-terminal subset in canonical order', () => {
    expect([...ROAD_RUN_NON_TERMINAL_STATES]).toEqual(
      ROAD_RUN_STATES.filter((s) => !isRoadRunTerminal(s)),
    );
  });
  it('matches the canonical literal subset', () => {
    expect([...ROAD_RUN_NON_TERMINAL_STATES]).toEqual(['planned', 'dispatched', 'started']);
  });
  it('is frozen', () => {
    expect(Object.isFrozen(ROAD_RUN_NON_TERMINAL_STATES)).toBe(true);
  });
});
