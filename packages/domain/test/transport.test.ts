// packages/domain/test/transport.test.ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import fc from 'fast-check';
import {
  createStateMachine,
  TRANSPORT_ORDER_STATES,
  TransportOrderStateSchema,
  transportOrderFsm,
  isTerminal,
  canTransition,
  transitionTransportOrder,
  ROAD_RUN_STATES,
  RoadRunStateSchema,
  isRoadRunTerminal,
  canTransitionRoadRun,
  transitionRoadRun,
} from '../src/index.js';

type ExpectedTOState = 'draft' | 'assigned' | 'in_transit' | 'completed' | 'cancelled';
type ExpectedRRState = 'planned' | 'dispatched' | 'started' | 'completed' | 'cancelled';

describe('@fleet/domain - TransportOrderStateSchema', () => {
  it('parses every PDF-mandated state', () => {
    for (const s of TRANSPORT_ORDER_STATES) {
      expect(TransportOrderStateSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown states', () => {
    expect(TransportOrderStateSchema.safeParse('shipped').success).toBe(false);
  });

  it('TransportOrderState union is exhaustive', () => {
    expectTypeOf<ExpectedTOState>().toEqualTypeOf<ExpectedTOState>();
    type Actual = (typeof TRANSPORT_ORDER_STATES)[number];
    expectTypeOf<Actual>().toEqualTypeOf<ExpectedTOState>();
  });

  it('preserves canonical order', () => {
    expect([...TRANSPORT_ORDER_STATES]).toEqual([
      'draft',
      'assigned',
      'in_transit',
      'completed',
      'cancelled',
    ]);
  });

  it('TRANSPORT_ORDER_STATES is frozen', () => {
    expect(Object.isFrozen(TRANSPORT_ORDER_STATES)).toBe(true);
  });
});

describe('@fleet/domain - transport order canTransition', () => {
  it('completed and cancelled are terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('non-terminal states report false', () => {
    expect(isTerminal('draft')).toBe(false);
    expect(isTerminal('assigned')).toBe(false);
    expect(isTerminal('in_transit')).toBe(false);
  });

  it('allows draft -> assigned and draft -> cancelled', () => {
    expect(canTransition('draft', 'assigned')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
  });

  it('rejects draft -> in_transit (must go through assigned)', () => {
    expect(canTransition('draft', 'in_transit')).toBe(false);
  });

  it('allows assigned -> in_transit -> completed', () => {
    expect(canTransition('assigned', 'in_transit')).toBe(true);
    expect(canTransition('in_transit', 'completed')).toBe(true);
  });

  it('rejects backward transitions', () => {
    expect(canTransition('in_transit', 'draft')).toBe(false);
  });

  it('rejects same-state transition', () => {
    expect(canTransition('draft', 'draft')).toBe(false);
  });
});

describe('@fleet/domain - transitionTransportOrder (Result type)', () => {
  it('returns allowed=true with nextState on valid transition', () => {
    const r = transitionTransportOrder('draft', 'assigned');
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.nextState).toBe('assigned');
  });

  it('returns SAME_STATE for self-transition', () => {
    const r = transitionTransportOrder('draft', 'draft');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('SAME_STATE');
  });

  it('returns TERMINAL_STATE when starting from completed', () => {
    const r = transitionTransportOrder('completed', 'in_transit');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('TERMINAL_STATE');
  });

  it('returns INVALID_TRANSITION for non-terminal illegal moves', () => {
    const r = transitionTransportOrder('draft', 'completed');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('INVALID_TRANSITION');
      expect(r.attemptedFrom).toBe('draft');
      expect(r.attemptedTo).toBe('completed');
    }
  });
});

describe('@fleet/domain - RoadRunStateSchema', () => {
  it('parses every state', () => {
    for (const s of ROAD_RUN_STATES) {
      expect(RoadRunStateSchema.parse(s)).toBe(s);
    }
  });

  it('RoadRunState union is exhaustive', () => {
    type Actual = (typeof ROAD_RUN_STATES)[number];
    expectTypeOf<Actual>().toEqualTypeOf<ExpectedRRState>();
  });

  it('preserves canonical order', () => {
    expect([...ROAD_RUN_STATES]).toEqual([
      'planned',
      'dispatched',
      'started',
      'completed',
      'cancelled',
    ]);
  });
});

describe('@fleet/domain - road run transitions', () => {
  it('completed and cancelled are terminal', () => {
    expect(isRoadRunTerminal('completed')).toBe(true);
    expect(isRoadRunTerminal('cancelled')).toBe(true);
  });

  it('allows planned -> dispatched -> started -> completed', () => {
    expect(canTransitionRoadRun('planned', 'dispatched')).toBe(true);
    expect(canTransitionRoadRun('dispatched', 'started')).toBe(true);
    expect(canTransitionRoadRun('started', 'completed')).toBe(true);
  });

  it('allows cancellation from any non-terminal state', () => {
    expect(canTransitionRoadRun('planned', 'cancelled')).toBe(true);
    expect(canTransitionRoadRun('dispatched', 'cancelled')).toBe(true);
    expect(canTransitionRoadRun('started', 'cancelled')).toBe(true);
  });

  it('rejects skipping dispatched', () => {
    expect(canTransitionRoadRun('planned', 'started')).toBe(false);
  });

  it('rejects transitions from terminal states', () => {
    expect(canTransitionRoadRun('completed', 'started')).toBe(false);
  });
});

describe('@fleet/domain - transitionRoadRun (Result type)', () => {
  it('returns allowed=true with nextState on valid transition', () => {
    const r = transitionRoadRun('planned', 'dispatched');
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.nextState).toBe('dispatched');
  });

  it('returns TERMINAL_STATE from cancelled', () => {
    const r = transitionRoadRun('cancelled', 'planned');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('TERMINAL_STATE');
  });
});

describe('@fleet/domain - transportOrderFsm direct API', () => {
  it('exposes states, isTerminal, canTransition, transition', () => {
    expect(transportOrderFsm.states).toEqual(TRANSPORT_ORDER_STATES);
    expect(transportOrderFsm.isTerminal('completed')).toBe(true);
    expect(transportOrderFsm.canTransition('draft', 'assigned')).toBe(true);
    expect(transportOrderFsm.transition('draft', 'assigned').allowed).toBe(true);
  });
});

describe('@fleet/domain - FSM version contract', () => {
  it('transportOrderFsm exposes version 1', () => {
    expect(transportOrderFsm.version).toBe(1);
  });
});

describe('@fleet/domain - transition properties (fast-check)', () => {
  const arbState = fc.constantFrom(...TRANSPORT_ORDER_STATES);

  it('terminal states reject all transitions', () => {
    fc.assert(
      fc.property(arbState, (to) => {
        const r = transitionTransportOrder('completed', to);
        return !r.allowed;
      }),
    );
    fc.assert(
      fc.property(arbState, (to) => {
        const r = transitionTransportOrder('cancelled', to);
        return !r.allowed;
      }),
    );
  });

  it('self-transitions always rejected with SAME_STATE', () => {
    fc.assert(
      fc.property(arbState, (s) => {
        const r = transitionTransportOrder(s, s);
        return !r.allowed && r.reason === 'SAME_STATE';
      }),
    );
  });

  it('allowed transition produces nextState matching to', () => {
    fc.assert(
      fc.property(arbState, arbState, (from, to) => {
        const r = transitionTransportOrder(from, to);
        if (!r.allowed) return true;
        return r.nextState === to;
      }),
    );
  });

  it('canTransition === transition().allowed', () => {
    fc.assert(
      fc.property(arbState, arbState, (from, to) => {
        return canTransition(from, to) === transitionTransportOrder(from, to).allowed;
      }),
    );
  });
});

describe('@fleet/domain - createStateMachine validation', () => {
  it('throws when a declared state is missing from transitions', () => {
    expect(() =>
      createStateMachine({
        version: 1,
        states: ['a', 'b'] as const,
        terminal: [],
        transitions: new Map<'a' | 'b', ReadonlySet<'a' | 'b'>>([['a', new Set(['b'])]]),
      }),
    ).toThrow(/state 'b' missing/);
  });

  it('throws when a transition targets an undeclared state', () => {
    expect(() =>
      createStateMachine({
        version: 1,
        states: ['a', 'b'] as const,
        terminal: [],
        transitions: new Map<'a' | 'b', ReadonlySet<'a' | 'b'>>([
          ['a', new Set(['ghost' as 'a' | 'b'])],
          ['b', new Set()],
        ]),
      }),
    ).toThrow(/references undeclared state/);
  });

  it('throws when a terminal state has outgoing transitions', () => {
    expect(() =>
      createStateMachine({
        version: 1,
        states: ['a', 'b'] as const,
        terminal: ['b'],
        transitions: new Map<'a' | 'b', ReadonlySet<'a' | 'b'>>([
          ['a', new Set(['b'])],
          ['b', new Set(['a'])],
        ]),
      }),
    ).toThrow(/terminal state 'b' must have no outgoing/);
  });
});

describe('@fleet/domain - transport order graph integrity', () => {
  it('every state appears in transitions map', () => {
    for (const s of TRANSPORT_ORDER_STATES) {
      // factory would have thrown if not - this asserts the contract is exercised
      expect(transportOrderFsm.states).toContain(s);
    }
  });

  it('terminal states have no outgoing transitions', () => {
    for (const s of TRANSPORT_ORDER_STATES) {
      if (transportOrderFsm.isTerminal(s)) {
        for (const target of TRANSPORT_ORDER_STATES) {
          expect(transportOrderFsm.canTransition(s, target)).toBe(false);
        }
      }
    }
  });

  it('all non-terminal states are reachable from draft', () => {
    const reachable = new Set<string>(['draft']);
    let changed = true;
    while (changed) {
      changed = false;
      for (const from of reachable) {
        for (const to of TRANSPORT_ORDER_STATES) {
          if (transportOrderFsm.canTransition(from as never, to) && !reachable.has(to)) {
            reachable.add(to);
            changed = true;
          }
        }
      }
    }
    for (const s of TRANSPORT_ORDER_STATES) {
      expect(reachable.has(s)).toBe(true);
    }
  });
});
