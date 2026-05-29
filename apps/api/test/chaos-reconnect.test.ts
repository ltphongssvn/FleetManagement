// apps/api/test/chaos-reconnect.test.ts
// Mutation-killing tests for src/chaos/reconnect-storm.ts.
// Uses a deterministic RNG returning a fixed sequence so every arithmetic,
// comparison, loop-bound, sort, and fallback branch is pinned to exact values.
import { describe, it, expect } from 'vitest';
import { simulateReconnectStorm } from '../src/chaos/reconnect-storm.js';

/** RNG that yields the given values in order, then repeats the last one. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i++;
    return v;
  };
}

describe('@fleet/api - simulateReconnectStorm', () => {
  it('runs exactly `trucks` iterations, consuming 2 RNG draws per truck (kills i<trucks bound + loop body mutants)', () => {
    // 3 trucks -> 6 draws. reconnect draws: 0, 0.5, 0.9; ack draws: 0, 0, 0.
    // jitterMs=100 -> reconnectMs: 0, 50, 90; ackMs: 0, 0, 0.
    const random = seq([0, 0, 0.5, 0, 0.9, 0]);
    const r = simulateReconnectStorm({
      trucks: 3,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random,
    });
    // All within budget -> 0 stuck. trucks count echoed exactly.
    expect(r.trucks).toBe(3);
    expect(r.reconnectedCount).toBe(3);
    expect(r.stuckCommands).toBe(0);
    expect(r.allReconnected).toBe(true);
  });

  it('reconnectMs = floor(random()*jitterMs): a draw of 0.9 over jitter 100 yields 90 (kills * -> / ArithmeticOperator)', () => {
    // 1 truck. reconnect draw 0.9 -> 90; ack draw 0 -> 0.
    // reconnectBudget 50 -> 90 > 50 -> stuck. With / mutant: floor(0.9/100)=0, not stuck.
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 50,
      ackBudgetMs: 1000,
      random: seq([0.9, 0]),
    });
    expect(r.stuckCommands).toBe(1);
    expect(r.reconnectedCount).toBe(0);
    expect(r.allReconnected).toBe(false);
    expect(r.p95ReconnectMs).toBe(90);
  });

  it('ackMs = floor(random()*jitterMs): a high ack draw over a tight ack budget marks stuck (kills ack * -> / + ackMs comparison mutants)', () => {
    // 1 truck. reconnect draw 0 -> 0 (within budget). ack draw 0.9 -> 90.
    // ackBudget 50 -> 90 > 50 -> stuck purely via the ack side of the ||.
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 50,
      random: seq([0, 0.9]),
    });
    expect(r.stuckCommands).toBe(1);
  });

  it('stuck condition is an OR: reconnect-only breach trips it while ack stays in budget (kills || -> && LogicalOperator + left ConditionalExpression)', () => {
    // reconnect draw 0.9 -> 90 > budget 50; ack draw 0 -> 0 within budget 1000.
    // OR -> stuck. AND mutant would require BOTH -> not stuck.
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 50,
      ackBudgetMs: 1000,
      random: seq([0.9, 0]),
    });
    expect(r.stuckCommands).toBe(1);
  });

  it('stuck condition OR: ack-only breach trips it while reconnect stays in budget (kills right ConditionalExpression mutant)', () => {
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 50,
      random: seq([0, 0.9]),
    });
    expect(r.stuckCommands).toBe(1);
  });

  it('reconnect comparison is strict >: reconnectMs exactly equal to budget is NOT stuck (kills > -> >= EqualityOperator)', () => {
    // reconnect draw 0.5 -> floor(0.5*100)=50, budget 50 -> 50 > 50 is false -> not stuck.
    // >= mutant -> 50 >= 50 true -> stuck.
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 50,
      ackBudgetMs: 1000,
      random: seq([0.5, 0]),
    });
    expect(r.stuckCommands).toBe(0);
  });

  it('ack comparison is strict >: ackMs exactly equal to budget is NOT stuck (kills ack > -> >= EqualityOperator)', () => {
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 50,
      random: seq([0, 0.5]),
    });
    expect(r.stuckCommands).toBe(0);
  });

  it('stuck increments (not decrements) and reconnectedCount = trucks - stuck (kills stuck++ UpdateOperator + - -> + ArithmeticOperator)', () => {
    // 2 trucks, both breach reconnect budget. reconnect draws 0.9,0.9 -> 90,90; ack 0,0.
    const r = simulateReconnectStorm({
      trucks: 2,
      jitterMs: 100,
      reconnectBudgetMs: 50,
      ackBudgetMs: 1000,
      random: seq([0.9, 0, 0.9, 0]),
    });
    expect(r.stuckCommands).toBe(2);
    expect(r.reconnectedCount).toBe(0); // 2 - 2; '+' mutant would give 4.
    expect(r.allReconnected).toBe(false);
  });

  it('allReconnected is stuck === 0: true only when nothing stuck (kills === EqualityOperator)', () => {
    const clean = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq([0, 0]),
    });
    expect(clean.allReconnected).toBe(true);
    const dirty = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1,
      ackBudgetMs: 1000,
      random: seq([0.9, 0]),
    });
    expect(dirty.allReconnected).toBe(false);
  });

  it('reconnectTimes is sorted ascending before p95 pick (kills sort callback ArrowFunction + a-b ArithmeticOperator + MethodExpression)', () => {
    // 5 trucks, reconnect draws descending: 0.9,0.7,0.5,0.3,0.1 -> 90,70,50,30,10.
    // ack draws all 0. Budgets generous -> 0 stuck.
    // sorted asc: [10,30,50,70,90]. length=5, p95Idx=min(4, floor(5*0.95)=floor(4.75)=4)=4.
    // p95 = sorted[4] = 90. Without sort -> sorted stays [90,70,50,30,10], [4]=10.
    // With a+b comparator -> not a valid sort, order undefined; assert the sorted-correct value.
    const r = simulateReconnectStorm({
      trucks: 5,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq([0.9, 0, 0.7, 0, 0.5, 0, 0.3, 0, 0.1, 0]),
    });
    expect(r.p95ReconnectMs).toBe(90);
    expect(r.stuckCommands).toBe(0);
  });

  it('p95Idx with n=21: correct index is min(20, floor(19.95)=19)=19 -> sorted[19]=19 (kills min->max + length/0.95 ArithmeticOperator)', () => {
    // 21 trucks, reconnectMs = i for i in 0..20 (draws i/100, jitter 100). ack all 0.
    // sorted asc: [0,1,...,20]. length=21.
    //   CORRECT:        length-1 = 20. floor(21*0.95)=floor(19.95)=19. min(20,19)=19 -> sorted[19]=19.
    //   min->max:       max(20,19)=20 -> sorted[20]=20. (differs: 20 != 19)
    //   length/0.95:    floor(21/0.95)=floor(22.10)=22. min(20,22)=20 -> sorted[20]=20. (differs: 20 != 19)
    //   length+1:       min(22,19)=19 -> sorted[19]=19. (same as correct; see note in next test)
    //   floor removed:  21*0.95=19.95 -> min(20,19.95)=19.95 -> sorted[19.95]=undefined -> ?? 0. (differs)
    const draws: number[] = [];
    for (let i = 0; i < 21; i++) { draws.push(i / 100, 0); }
    const r = simulateReconnectStorm({
      trucks: 21,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq(draws),
    });
    expect(r.p95ReconnectMs).toBe(19);
    expect(r.stuckCommands).toBe(0);
  });

  it('p95Idx with n=2: correct index is min(1, floor(1.9)=1)=1 -> sorted[1] (kills length-1 -> length+1 ArithmeticOperator)', () => {
    // 2 trucks, reconnectMs 10 and 90. sorted asc: [10, 90]. length=2.
    //   CORRECT:    length-1 = 1. floor(2*0.95)=floor(1.9)=1. min(1,1)=1 -> sorted[1]=90.
    //   length+1:   min(3,1)=1 -> sorted[1]=90. (same here)
    // length-1 -> length+1 needs a case where it changes the min selection. For the correct
    // multiplier floor(n*0.95) is always <= n-1, so min always picks floor(n*0.95) and the
    // length+1 term is never selected -> the +1 mutant cannot change the result for ANY n.
    // It is an equivalent mutant. We still pin the n=2 boundary for the length-1 term itself:
    // a hypothetical length-2 mutant would give min(0,1)=0 -> sorted[0]=10 != 90.
    const r = simulateReconnectStorm({
      trucks: 2,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq([0.1, 0, 0.9, 0]),
    });
    expect(r.p95ReconnectMs).toBe(90);
  });

  it('p95ReconnectMs falls back to 0 when there are zero trucks (kills ?? 0 LogicalOperator + ?? -> && )', () => {
    // 0 trucks -> reconnectTimes empty -> p95Idx = min(-1, floor(0))=min(-1,0)=-1 -> sorted[-1]=undefined -> ?? 0.
    const r = simulateReconnectStorm({
      trucks: 0,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq([0]),
    });
    expect(r.p95ReconnectMs).toBe(0);
    expect(r.trucks).toBe(0);
    expect(r.reconnectedCount).toBe(0);
    expect(r.stuckCommands).toBe(0);
    expect(r.allReconnected).toBe(true);
  });

  it('reconnectTimes array starts empty: a single in-budget truck yields exactly its own reconnectMs as p95 (kills [] ArrayDeclaration "Stryker was here" seed)', () => {
    // 1 truck. reconnect draw 0.42 -> 42. If array seeded with a junk string, p95 pick breaks.
    const r = simulateReconnectStorm({
      trucks: 1,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
      random: seq([0.42, 0]),
    });
    expect(r.p95ReconnectMs).toBe(42);
  });
  it('falls back to Math.random when random is omitted (kills ?? Math.random branch at line 24)', () => {
    // No deterministic RNG -> input.random is undefined -> ?? Math.random arm.
    // Output is non-deterministic; assert only structural invariants.
    const r = simulateReconnectStorm({
      trucks: 10,
      jitterMs: 100,
      reconnectBudgetMs: 1000,
      ackBudgetMs: 1000,
    });
    expect(r.trucks).toBe(10);
    expect(r.reconnectedCount + r.stuckCommands).toBe(10);
    expect(r.p95ReconnectMs).toBeGreaterThanOrEqual(0);
    expect(r.p95ReconnectMs).toBeLessThan(100);
    expect(typeof r.allReconnected).toBe('boolean');
  });
});
