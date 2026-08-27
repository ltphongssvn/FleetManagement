// apps/api/test/command-push-dlq.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  CommandsGateway,
  COMMAND_DELIVERY_POLICY_VERSION,
} from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';
import { COMMAND_PUSH_MAX_ATTEMPTS } from '../src/commands/command-policy.js';

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

function makeGw(failingPush: IPushProvider['sendToOperator']): CommandsGateway {
  const t0 = new Date('2026-05-02T10:00:00.000Z');
  const fakeClock: Clock = { now: () => t0 };
  return new CommandsGateway({ sendToOperator: failingPush }, fakeClock);
}

describe('@fleet/api - CommandsGateway push DLQ', () => {
  it('moves command to DLQ after MAX push attempts and purges from pending', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new Error('expo down')) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(failing);
    (gw as unknown as PendingMap).pending.set('cDLQ', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    for (let i = 0; i < COMMAND_PUSH_MAX_ATTEMPTS; i++) {
      gw.reconcileNow(new Date());
      await new Promise((r) => {
        setTimeout(r, 10);
      });
    }
    expect(gw.pendingCount()).toBe(0);
    expect(gw.getDeadLetters().map((d) => d.commandId)).toEqual(['cDLQ']);
    expect(failing).toHaveBeenCalledTimes(COMMAND_PUSH_MAX_ATTEMPTS);
  });

  it('retains in pending below MAX push attempts', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new Error('expo down')) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(failing);
    (gw as unknown as PendingMap).pending.set('cRetry', {
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
    expect(gw.pendingCount()).toBe(1);
    expect(gw.getDeadLetters()).toEqual([]);
    const entry = (gw as unknown as PendingMap).pending.get('cRetry');
    expect(entry?.pushAttempts).toBe(1);
  });

  it('purges from pending on push success (no DLQ entry)', async () => {
    const ok = vi.fn().mockResolvedValue({
      accepted: 1,
      rejected: 0,
    }) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(ok);
    (gw as unknown as PendingMap).pending.set('cOk', {
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
    expect(gw.pendingCount()).toBe(0);
    expect(gw.getDeadLetters()).toEqual([]);
  });

  it('DLQ entry carries diagnostic context (operatorId, lastError, attempts)', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(new Error('expo down')) as unknown as IPushProvider['sendToOperator'];
    const gw = makeGw(failing);
    (gw as unknown as PendingMap).pending.set('cCtx', {
      operatorId: 'op-ctx',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    for (let i = 0; i < COMMAND_PUSH_MAX_ATTEMPTS; i++) {
      gw.reconcileNow(new Date());
      await new Promise((r) => {
        setTimeout(r, 10);
      });
    }
    const dlq = gw.getDeadLetters();
    expect(dlq.length).toBe(1);
    expect(dlq[0]?.operatorId).toBe('op-ctx');
    expect(dlq[0]?.pushAttempts).toBe(COMMAND_PUSH_MAX_ATTEMPTS);
    expect(dlq[0]?.lastError).toMatch(/expo down/);
  });
});
