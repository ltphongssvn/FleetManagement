// apps/api/test/commands.gateway.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';

interface PendingMap {
  readonly pending: Map<string, { operatorId: string; issuedAt: Date; attempts: number; policyVersion: string }>;
}

describe('@fleet/api - CommandsGateway reconciler', () => {
  let gw: CommandsGateway;
  let pushSpy: IPushProvider['sendToOperator'];

  beforeEach(() => {
    pushSpy = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 }) as unknown as IPushProvider['sendToOperator'];
    const mockPush: IPushProvider = { sendToOperator: pushSpy };
    gw = new CommandsGateway(mockPush);
    gw.clearPending();
  });

  it('flushes pending entry that timed out at max attempts and triggers push', () => {
    (gw as unknown as PendingMap).pending.set('c1', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    const fallbacks = gw.reconcileNow(new Date());
    expect(fallbacks).toEqual(['c1']);
    expect(pushSpy).toHaveBeenCalledOnce();
  });

  it('does not flush within timeout window', () => {
    (gw as unknown as PendingMap).pending.set('c2', {
      operatorId: 'op1',
      issuedAt: new Date(),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(gw.reconcileNow(new Date())).toEqual([]);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does not flush below max attempts', () => {
    (gw as unknown as PendingMap).pending.set('c3', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(gw.reconcileNow(new Date())).toEqual([]);
  });

  it('latency samples start empty', () => {
    expect(gw.getLatencySamples()).toEqual([]);
  });

  it('exposes policy version constant', () => {
    expect(COMMAND_DELIVERY_POLICY_VERSION).toBe('command-delivery-v1');
  });

  it('works without a push provider injected (optional)', () => {
    const noPush = new CommandsGateway();
    (noPush as unknown as PendingMap).pending.set('c4', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(noPush.reconcileNow(new Date())).toEqual(['c4']);
  });

  it('retains pending entry when push fallback rejects', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('expo down')) as unknown as IPushProvider['sendToOperator'];
    const failGw = new CommandsGateway({ sendToOperator: failing });
    (failGw as unknown as PendingMap).pending.set('cFail', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    failGw.reconcileNow(new Date());
    await new Promise((r) => { setTimeout(r, 20); });
    expect(failGw.pendingCount()).toBe(1);
  });
});
