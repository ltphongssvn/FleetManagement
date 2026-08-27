// packages/domain/src/state-machines/finite-state-machine.ts
// Generic FSM factory for domain state machines.
// Returns Result type with reason for failed transitions (UI-actionable).

export type TransitionResult<S extends string> =
  | { readonly allowed: true; readonly nextState: S }
  | {
      readonly allowed: false;
      readonly reason: TransitionFailureReason;
      readonly attemptedFrom: S;
      readonly attemptedTo: S;
    };

export type TransitionFailureReason = 'TERMINAL_STATE' | 'INVALID_TRANSITION' | 'SAME_STATE';

export interface FiniteStateMachine<S extends string> {
  readonly version: number;
  readonly states: readonly S[];
  readonly isTerminal: (state: S) => boolean;
  readonly canTransition: (from: S, to: S) => boolean;
  readonly transition: (from: S, to: S) => TransitionResult<S>;
}

export interface FsmDefinition<S extends string> {
  readonly version: number;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  readonly transitions: ReadonlyMap<S, ReadonlySet<S>>;
}

export function createStateMachine<S extends string>(def: FsmDefinition<S>): FiniteStateMachine<S> {
  // Exhaustiveness: every declared state must have a transitions entry.
  for (const state of def.states) {
    if (!def.transitions.has(state)) {
      throw new Error("createStateMachine: state '" + state + "' missing from transitions map");
    }
  }
  // Reachability: every transition target must be a declared state.
  for (const [from, targets] of def.transitions) {
    for (const target of targets) {
      if (!def.states.includes(target)) {
        throw new Error(
          'createStateMachine: transition ' +
            from +
            ' -> ' +
            target +
            ' references undeclared state',
        );
      }
    }
  }
  // Terminal states must be declared in states[] and have empty transition set.
  for (const t of def.terminal) {
    if (!def.states.includes(t)) {
      throw new Error("createStateMachine: terminal state '" + t + "' is not declared in states[]");
    }
    const targets = def.transitions.get(t);
    if (targets && targets.size > 0) {
      throw new Error(
        "createStateMachine: terminal state '" + t + "' must have no outgoing transitions",
      );
    }
  }

  const terminalSet: ReadonlySet<S> = new Set(def.terminal);

  const isTerminal = (state: S): boolean => terminalSet.has(state);

  const canTransition = (from: S, to: S): boolean => def.transitions.get(from)?.has(to) ?? false;

  const transition = (from: S, to: S): TransitionResult<S> => {
    if (from === to) {
      return { allowed: false, reason: 'SAME_STATE', attemptedFrom: from, attemptedTo: to };
    }
    if (isTerminal(from)) {
      return { allowed: false, reason: 'TERMINAL_STATE', attemptedFrom: from, attemptedTo: to };
    }
    if (!canTransition(from, to)) {
      return { allowed: false, reason: 'INVALID_TRANSITION', attemptedFrom: from, attemptedTo: to };
    }
    return { allowed: true, nextState: to };
  };

  return { version: def.version, states: def.states, isTerminal, canTransition, transition };
}
