// apps/api/test/command-reconciler-overlap.test.ts
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

function makeGw(push: IPushProvider['sendToOperator']): CommandsGateway {
  const t0 = new Date('2026-05-02T10:00:00.000Z');
  const fakeClock: Clock = { now: () => t0 };
  return new CommandsGateway({ sendToOperator: push }, fakeClock);
}

describe('@fleet/api - CommandsGateway reconciler overlap protection', () => {
  it('does not invoke push provider twice for same command while previous push is in flight', () => {
    let resolveFn: ((v: { accepted: number; rejected: number }) => void) | null = null;
    const push = vi.fn().mockImplementation(
      () =>
        new Promise<{ accepted: number; rejected: number }>((r) => {
          resolveFn = r;
        }),
    ) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(push);
    (gw as unknown as PendingMap).pending.set('cSlow', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    gw.reconcileNow(new Date());
    gw.reconcileNow(new Date());
    expect(push).toHaveBeenCalledTimes(1);
    (resolveFn as ((v: { accepted: number; rejected: number }) => void) | null)?.({
      accepted: 1,
      rejected: 0,
    });
  });

  it('marks pushInFlight on entry while push pending', () => {
    const push = vi.fn().mockImplementation(
      () =>
        new Promise<{ accepted: number; rejected: number }>(() => {
          /* never resolves */
        }),
    ) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(push);
    (gw as unknown as PendingMap).pending.set('cFlight', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    const entry = (gw as unknown as PendingMap).pending.get('cFlight');
    expect(entry?.pushInFlight).toBe(true);
  });

  it('clears pushInFlight after push resolves and allows next attempt', async () => {
    let attempt = 0;
    const push = vi.fn().mockImplementation(() => {
      attempt += 1;
      return Promise.reject(new Error('fail'));
    }) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(push);
    (gw as unknown as PendingMap).pending.set('cSeq', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    gw.reconcileNow(new Date());
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    gw.reconcileNow(new Date());
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(attempt).toBe(2);
    const entry = (gw as unknown as PendingMap).pending.get('cSeq');
    expect(entry?.pushInFlight).toBe(false);
  });
});
