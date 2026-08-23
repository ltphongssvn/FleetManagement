// apps/api/test/commands-gateway-shutdown.test.ts
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

describe('@fleet/api - CommandsGateway graceful shutdown', () => {
  it('onModuleDestroy awaits in-flight push promises before resolving', async () => {
    let resolveFn: ((v: { accepted: number; rejected: number }) => void) | null = null;
    const slowPush = vi.fn().mockImplementation(
      () =>
        new Promise<{ accepted: number; rejected: number }>((r) => {
          resolveFn = r;
        }),
    ) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: slowPush }, fakeClock);
    (gw as unknown as PendingMap).pending.set('cShut', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    let destroyed = false;
    const destroyP = gw.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    expect(destroyed).toBe(false);
    (resolveFn as unknown as (v: { accepted: number; rejected: number }) => void)({
      accepted: 1,
      rejected: 0,
    });
    await destroyP;
    expect(destroyed).toBe(true);
  });

  it('onModuleDestroy resolves immediately when no pending pushes', async () => {
    const gw = new CommandsGateway();
    await expect(gw.onModuleDestroy()).resolves.toBeUndefined();
  });
});
