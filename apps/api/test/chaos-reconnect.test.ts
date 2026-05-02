// apps/api/test/chaos-reconnect.test.ts
import { describe, it, expect } from 'vitest';
import { simulateReconnectStorm } from '../src/chaos/reconnect-storm.js';

describe('@fleet/api - simulateReconnectStorm', () => {
  it('reports zero stuck commands when all reconcile within budget', () => {
    const r = simulateReconnectStorm({ trucks: 5, jitterMs: 100, reconnectBudgetMs: 5000, ackBudgetMs: 2000 });
    expect(r.stuckCommands).toBe(0);
    expect(r.allReconnected).toBe(true);
  });
  it('flags stuck commands when ack budget too tight', () => {
    const r = simulateReconnectStorm({ trucks: 5, jitterMs: 5000, reconnectBudgetMs: 100, ackBudgetMs: 100 });
    expect(r.allReconnected).toBe(false);
  });
});
