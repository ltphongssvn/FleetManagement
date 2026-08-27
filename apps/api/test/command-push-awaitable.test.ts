// apps/api/test/command-push-awaitable.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  CommandsGateway,
  COMMAND_DELIVERY_POLICY_VERSION,
} from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';

interface PendingMap {
  readonly pending: Map<
    string,
    {
      operatorId: string;
      issuedAt: Date;
      attempts: number;
      pushAttempts: number;
      pushInFlight: boolean;
      policyVersion: string;
    }
  >;
}

describe('@fleet/api - CommandsGateway awaitable push fallback', () => {
  it('exposes pendingPushPromise(commandId) so tests can await without setTimeout hacks', async () => {
    const ok = vi.fn().mockResolvedValue({
      accepted: 1,
      rejected: 0,
    }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: ok }, fakeClock);
    (gw as unknown as PendingMap).pending.set('cAwait', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    const p = gw.pendingPushPromise('cAwait');
    expect(p).toBeDefined();
    await p;
    expect(gw.pendingCount()).toBe(0);
  });

  it('returns undefined when no push in flight for that command', () => {
    const gw = new CommandsGateway();
    expect(gw.pendingPushPromise('nope')).toBeUndefined();
  });

  it('clears pendingPushPromise entry after settle (success)', async () => {
    const ok = vi.fn().mockResolvedValue({
      accepted: 1,
      rejected: 0,
    }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: ok }, fakeClock);
    (gw as unknown as PendingMap).pending.set('cClean', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    await gw.pendingPushPromise('cClean');
    expect(gw.pendingPushPromise('cClean')).toBeUndefined();
  });
});
