// apps/api/src/chaos/reconnect-storm.ts
// Pure simulator for reconnect-storm chaos drill per PDF Day-One Week 8:
// "chaos drill (reconnect storm w/ 5 trucks)".
// Models n trucks reconnecting with random jitter, each with one pending command
// awaiting ack within budgets. Pure -> deterministic with injected RNG.

export interface ReconnectStormInput {
  readonly trucks: number;
  readonly jitterMs: number;
  readonly reconnectBudgetMs: number;
  readonly ackBudgetMs: number;
  readonly random?: () => number;
}

export interface ReconnectStormResult {
  readonly trucks: number;
  readonly reconnectedCount: number;
  readonly stuckCommands: number;
  readonly allReconnected: boolean;
  readonly p95ReconnectMs: number;
}

export function simulateReconnectStorm(input: ReconnectStormInput): ReconnectStormResult {
  const random = input.random ?? Math.random;
  const reconnectTimes: number[] = [];
  let stuck = 0;
  for (let i = 0; i < input.trucks; i++) {
    const reconnectMs = Math.floor(random() * input.jitterMs);
    reconnectTimes.push(reconnectMs);
    const ackMs = Math.floor(random() * input.jitterMs);
    if (reconnectMs > input.reconnectBudgetMs || ackMs > input.ackBudgetMs) stuck++;
  }
  reconnectTimes.sort((a, b) => a - b);
  const p95Idx = Math.min(reconnectTimes.length - 1, Math.floor(reconnectTimes.length * 0.95));
  return {
    trucks: input.trucks,
    reconnectedCount: input.trucks - stuck,
    stuckCommands: stuck,
    allReconnected: stuck === 0,
    p95ReconnectMs: reconnectTimes[p95Idx] ?? 0,
  };
}
