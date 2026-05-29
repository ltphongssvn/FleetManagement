// packages/domain/test/finite-state-machine-validation.test.ts
// TDD RED: kill Stryker survivors on validation error paths.
import { describe, it, expect } from 'vitest';
import { createStateMachine } from '../src/state-machines/finite-state-machine.js';

describe('createStateMachine validation error messages', () => {
  it('missing transitions error contains "createStateMachine" prefix and state name', () => {
    expect(() => createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: [],
      transitions: new Map([['a', new Set(['b'])]]),
    })).toThrow(/createStateMachine: state 'b' missing from transitions map/);
  });

  it('undeclared target error contains "createStateMachine: transition" prefix, from, and target', () => {
    expect(() => createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: [],
      transitions: new Map<'a' | 'b', ReadonlySet<'a' | 'b'>>([
        ['a', new Set(['b'])],
        ['b', new Set(['c' as 'a'])],
      ]),
    })).toThrow(/createStateMachine: transition b -> c references undeclared state/);
  });

  it('terminal with outgoing error contains "createStateMachine: terminal state" prefix and state name', () => {
    expect(() => createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: ['b'],
      transitions: new Map<'a' | 'b', ReadonlySet<'a' | 'b'>>([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
      ]),
    })).toThrow(/createStateMachine: terminal state 'b' must have no outgoing transitions/);
  });

  it('terminal with empty Set (size === 0) does NOT throw', () => {
    expect(() => createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: ['b'],
      transitions: new Map([
        ['a', new Set(['b'] as const)],
        ['b', new Set<'a' | 'b'>()],
      ]),
    })).not.toThrow();
  });

  it('terminal state listed in terminal[] but missing from transitions map throws (catches OptionalChaining mutant)', () => {
    expect(() => createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: ['c' as 'a'],
      transitions: new Map([
        ['a', new Set(['b'] as const)],
        ['b', new Set<'a' | 'b'>()],
      ]),
    })).toThrow(/createStateMachine: terminal state 'c' is not declared in states\[\]/);
  });
});

describe('createStateMachine canTransition with map.get returning undefined', () => {
  it('returns false (not true) when from-state has no entry in transitions map', () => {
    // Build a valid 2-state FSM, then call canTransition with a state not in the map.
    const fsm = createStateMachine({
      version: 1,
      states: ['a', 'b'] as const,
      terminal: ['b'],
      transitions: new Map([
        ['a', new Set(['b'] as const)],
        ['b', new Set<'a' | 'b'>()],
      ]),
    });
    // Type-cast: cover the ?? false branch when get() returns undefined.
    expect(fsm.canTransition('zzz' as 'a', 'a')).toBe(false);
  });
});
