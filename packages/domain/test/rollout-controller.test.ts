// packages/domain/test/rollout-controller.test.ts
// RED-first test for the deployment controller: the pure state transition that
// drives a rollout up the ladder, holds it, or rolls it back, given a verdict
// from the analysis engine. This closes the loop the spec describes -- increase
// exposure when promote, keep the current percentage when hold, return to the
// previous version when rollback.
//
// State is (stageIndex into the ladder, phase, breachHistory). The controller is
// pure: advanceRollout(state, verdict, ladder) returns the next state and never
// performs IO. The app layer fetches metrics, calls decideRollout to get the
// verdict, calls advanceRollout to get the next state, then actually shifts
// traffic and persists the state.
//
// promote:      step to the next rung; at the last rung the rollout is complete.
// hold:         stay on the current rung, unchanged.
// inconclusive: also stay on the current rung. The decision to roll back on an
//               exhausted inconclusive budget is made INSIDE decideRollout, which
//               returns rollback in that case; a plain inconclusive verdict means
//               the round could not be judged but the budget is not spent, so the
//               controller waits exactly as it does on hold. It never climbs on
//               inconclusive -- raising exposure on evidence you could not read
//               is the opposite of progressive delivery.
// rollback:     go to the terminal rolled_back phase; exposure returns to zero.
//
// The controller owns the breach tally the analysis engine delegates: a promote
// or a completed rollout clears it, a hold carries it forward incremented for the
// breaching metric. A terminal phase is absorbing -- no verdict moves it.
import { describe, it, expect } from 'vitest';
import {
  startRollout,
  advanceRollout,
  type RolloutState,
} from '../src/delivery/rollout-controller.js';
import { DEFAULT_ROLLOUT_LADDER } from '../src/delivery/rollout-stage.js';

const LADDER = DEFAULT_ROLLOUT_LADDER;

function exposureOf(state: RolloutState): number {
  const stage = LADDER[state.stageIndex];
  if (stage === undefined) throw new Error('stage index out of ladder');
  return stage.exposurePercent;
}

describe('startRollout: begins internal-only at the first rung', () => {
  it('starts at stage 0 in the running phase', () => {
    const s = startRollout();
    expect(s.stageIndex).toBe(0);
    expect(s.phase).toBe('running');
  });

  it('starts internal-only at 0 percent exposure', () => {
    expect(exposureOf(startRollout())).toBe(0);
  });
});

describe('advanceRollout: promote steps up the ladder', () => {
  it('moves from internal to the first traffic rung', () => {
    const next = advanceRollout(startRollout(), 'promote', LADDER);
    expect(next.stageIndex).toBe(1);
    expect(exposureOf(next)).toBe(1);
  });

  it('climbs one rung at a time across the whole ladder', () => {
    let s = startRollout();
    const seen = [exposureOf(s)];
    for (let i = 0; i < LADDER.length - 1; i += 1) {
      s = advanceRollout(s, 'promote', LADDER);
      seen.push(exposureOf(s));
    }
    expect(seen).toEqual([0, 1, 10, 50, 100]);
  });

  it('reaches the complete phase when promoted off the final rung', () => {
    let s = startRollout();
    for (let i = 0; i < LADDER.length - 1; i += 1) {
      s = advanceRollout(s, 'promote', LADDER);
    }
    expect(s.phase).toBe('running');
    expect(exposureOf(s)).toBe(100);
    const done = advanceRollout(s, 'promote', LADDER);
    expect(done.phase).toBe('complete');
  });
});

describe('advanceRollout: hold stays put', () => {
  it('keeps the same rung and phase on hold', () => {
    const start = advanceRollout(startRollout(), 'promote', LADDER);
    const held = advanceRollout(start, 'hold', LADDER);
    expect(held.stageIndex).toBe(start.stageIndex);
    expect(held.phase).toBe('running');
  });

  it('does not advance exposure on repeated holds', () => {
    let s = advanceRollout(startRollout(), 'promote', LADDER);
    s = advanceRollout(s, 'hold', LADDER);
    s = advanceRollout(s, 'hold', LADDER);
    expect(exposureOf(s)).toBe(1);
  });
});

describe('advanceRollout: inconclusive stays put, like hold', () => {
  it('keeps the same rung and phase on inconclusive', () => {
    const start = advanceRollout(startRollout(), 'promote', LADDER);
    const held = advanceRollout(start, 'inconclusive', LADDER);
    expect(held.stageIndex).toBe(start.stageIndex);
    expect(held.phase).toBe('running');
  });

  it('never climbs the ladder on inconclusive', () => {
    let s = advanceRollout(startRollout(), 'promote', LADDER);
    s = advanceRollout(s, 'inconclusive', LADDER);
    s = advanceRollout(s, 'inconclusive', LADDER);
    expect(exposureOf(s)).toBe(1);
  });

  it('does not roll back on a plain inconclusive verdict', () => {
    const start = advanceRollout(startRollout(), 'promote', LADDER);
    const next = advanceRollout(start, 'inconclusive', LADDER);
    expect(next.phase).toBe('running');
  });
});

describe('advanceRollout: rollback is terminal and returns to zero', () => {
  it('enters the rolled_back phase from any rung', () => {
    let s = startRollout();
    s = advanceRollout(s, 'promote', LADDER);
    s = advanceRollout(s, 'promote', LADDER);
    const back = advanceRollout(s, 'rollback', LADDER);
    expect(back.phase).toBe('rolled_back');
  });

  it('returns exposure to zero on rollback', () => {
    const s = advanceRollout(startRollout(), 'promote', LADDER);
    const back = advanceRollout(s, 'rollback', LADDER);
    expect(exposureOf(back)).toBe(0);
  });
});

describe('advanceRollout: terminal phases are absorbing', () => {
  it('does not move once complete', () => {
    let s = startRollout();
    for (const _rung of LADDER) {
      void _rung;
      s = advanceRollout(s, 'promote', LADDER);
    }
    expect(s.phase).toBe('complete');
    const still = advanceRollout(s, 'rollback', LADDER);
    expect(still).toEqual(s);
  });

  it('does not move once rolled back', () => {
    const back = advanceRollout(startRollout(), 'rollback', LADDER);
    const still = advanceRollout(back, 'promote', LADDER);
    expect(still).toEqual(back);
  });
});
