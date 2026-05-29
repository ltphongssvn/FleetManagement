// apps/api/test/command-reconcile-allsettled.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';

interface PendingMap {
  readonly pending: Map<string, { operatorId: string; issuedAt: Date; attempts: number; pushAttempts: number; pushInFlight: boolean; policyVersion: string }>;
}

function gw(push: IPushProvider['sendToOperator']): CommandsGateway {
  const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
  return new CommandsGateway({ sendToOperator: push }, fakeClock);
}

function seed(g: CommandsGateway, id: string): void {
  (g as unknown as PendingMap).pending.set(id, {
    operatorId: 'op1',
    issuedAt: new Date(Date.now() - 60_000),
    attempts: 3,
    pushAttempts: 0,
    pushInFlight: false,
    policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
  });
}

describe('@fleet/api - reconcileAndSettle (awaitable)', () => {
  it('returns a promise that resolves after all push fallbacks settle', async () => {
    const ok = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 }) as unknown as IPushProvider['sendToOperator'];
    const g = gw(ok);
    seed(g, 'cA'); seed(g, 'cB'); seed(g, 'cC');
    const result = await g.reconcileAndSettle(new Date());
    expect(result.flushed).toEqual(['cA', 'cB', 'cC']);
    expect(result.settled).toBe(3);
    expect(g.pendingCount()).toBe(0);
  });

  it('settles even when some pushes reject (Promise.allSettled semantics)', async () => {
    let i = 0;
    const mixed = vi.fn().mockImplementation(() => {
      i += 1;
      return i % 2 === 0 ? Promise.reject(new Error('fail')) : Promise.resolve({ accepted: 1, rejected: 0 });
    }) as unknown as IPushProvider['sendToOperator'];
    const g = gw(mixed);
    seed(g, 'c1'); seed(g, 'c2');
    const result = await g.reconcileAndSettle(new Date());
    expect(result.settled).toBe(2);
  });

  it('returns flushed=[] settled=0 when nothing to reconcile', async () => {
    const g = gw(vi.fn() as unknown as IPushProvider['sendToOperator']);
    const result = await g.reconcileAndSettle(new Date());
    expect(result).toEqual({ flushed: [], settled: 0 });
  });
});
