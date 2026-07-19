// packages/domain/src/delivery/rollout-controller.ts
// The deployment controller as a pure state machine, in the same spirit as
// finite-state-machine.ts: a transition function, no IO. It closes the
// progressive-delivery loop the spec describes -- increase exposure when the
// analysis says promote, keep the current percentage on hold, return to the
// previous version on rollback -- while leaving the actual traffic shift and the
// metric fetch to the app layer that calls it.
//
// State is a rung index into the ladder plus a phase. The phases:
//   running     -> climbing the ladder, exposure is the current rung
//   complete    -> promoted off the final 100 percent rung; the release is done
//   rolled_back -> a guardrail hit its failure budget; exposure returns to zero
// Both complete and rolled_back are terminal and absorbing: once there, no
// verdict moves the rollout, so a late metric sample cannot resurrect a killed
// release or un-finish a finished one.
//
// The controller owns the breach tally decideRollout delegates. It is carried in
// the state so the whole rollout is one serialisable value the app can persist
// between evaluations. A promote or completion clears it; hold leaves it for the
// caller to increment per breaching metric before the next decideRollout.
//
// Pure: advanceRollout(state, verdict, ladder) is a total function of its inputs.
// Same state and verdict always yield the same next state, so the entire rollout
// is unit-testable without a deployment.
import type { RolloutVerdict } from './rollout-verdict.js';
import type { RolloutLadder } from './rollout-stage.js';
import type { BreachHistory } from './rollout-analysis.js';

export type RolloutPhase = 'running' | 'complete' | 'rolled_back';

export interface RolloutState {
  readonly stageIndex: number;
  readonly phase: RolloutPhase;
  readonly breachHistory: BreachHistory;
}

/** Begin a rollout at the first rung (internal-only, 0 percent) in the running phase. */
export function startRollout(): RolloutState {
  return { stageIndex: 0, phase: 'running', breachHistory: {} };
}

/**
 * Advance the rollout by one evaluation. promote climbs a rung, or completes off
 * the last one; hold stays; rollback goes terminal at zero exposure. Terminal
 * phases are absorbing.
 */
export function advanceRollout(
  state: RolloutState,
  verdict: RolloutVerdict,
  ladder: RolloutLadder,
): RolloutState {
  if (state.phase !== 'running') return state;

  if (verdict === 'rollback') {
    return { stageIndex: 0, phase: 'rolled_back', breachHistory: {} };
  }

  if (verdict === 'hold') return state;

  const isFinalRung = state.stageIndex >= ladder.length - 1;
  if (isFinalRung) {
    return { stageIndex: state.stageIndex, phase: 'complete', breachHistory: {} };
  }
  return { stageIndex: state.stageIndex + 1, phase: 'running', breachHistory: {} };
}
