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
    expect(gw.reconcileNow(new Date())).toEqual(['c1']);
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

  it('handleAck succeeds for rejected status with valid uuid + matching operator', () => {
    const cmdId = '11111111-1111-4111-8111-111111111111';
    const operatorId = '22222222-2222-4222-8222-222222222222';
    (gw as unknown as PendingMap).pending.set(cmdId, {
      operatorId,
      issuedAt: new Date(),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    const fakeSocket = { id: 'sock-1', data: { operatorId } } as never;
    const result = gw.handleAck(
      {
        commandId: cmdId,
        ackedAt: new Date().toISOString(),
        status: 'rejected',
        reasonCode: 'invalid_state',
      },
      fakeSocket,
    );
    expect(result.ok).toBe(true);
    expect(gw.pendingCount()).toBe(0);
  });

  it('handleAck rejects malformed body with invalid_payload', () => {
    const fakeSocket = { id: 'sock-bad', data: {} } as never;
    const result = gw.handleAck({ garbage: true }, fakeSocket);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_payload');
  });

  it('handleAck returns operator_mismatch when socket operator differs from pending entry', () => {
    const cmdId = '33333333-3333-4333-8333-333333333333';
    (gw as unknown as PendingMap).pending.set(cmdId, {
      operatorId: '44444444-4444-4444-8444-444444444444',
      issuedAt: new Date(),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    const fakeSocket = {
      id: 'sock-other',
      data: { operatorId: '55555555-5555-4555-8555-555555555555' },
    } as never;
    const result = gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      fakeSocket,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('operator_mismatch');
  });

  it('handleAck returns unknown_command for valid ack on missing entry', () => {
    const fakeSocket = { id: 's', data: { operatorId: 'op' } } as never;
    const result = gw.handleAck(
      {
        commandId: '66666666-6666-4666-8666-666666666666',
        ackedAt: new Date().toISOString(),
        status: 'received',
      },
      fakeSocket,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_command');
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
