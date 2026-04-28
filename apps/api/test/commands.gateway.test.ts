// apps/api/test/commands.gateway.test.ts
// Unit tests for CommandsGateway reconciler + latency tracking.
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } from '../src/commands/commands.gateway.js';

interface PendingMap {
  readonly pending: Map<string, { operatorId: string; issuedAt: Date; attempts: number; policyVersion: string }>;
}

describe('@fleet/api - CommandsGateway reconciler', () => {
  let gw: CommandsGateway;

  beforeEach(() => {
    gw = new CommandsGateway();
    gw.clearPending();
  });

  it('flushes pending entry that timed out at max attempts', () => {
    const issuedAt = new Date(Date.now() - 60_000);
    (gw as unknown as PendingMap).pending.set('c1', {
      operatorId: 'op1',
      issuedAt,
      attempts: 3,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(gw.pendingCount()).toBe(1);
    const fallbacks = gw.reconcileNow(new Date());
    expect(fallbacks).toEqual(['c1']);
    expect(gw.pendingCount()).toBe(0);
  });

  it('does not flush entries within timeout window', () => {
    (gw as unknown as PendingMap).pending.set('c2', {
      operatorId: 'op1',
      issuedAt: new Date(),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(gw.reconcileNow(new Date())).toEqual([]);
    expect(gw.pendingCount()).toBe(1);
  });

  it('does not flush timed-out entries below max attempts (would retry)', () => {
    (gw as unknown as PendingMap).pending.set('c3', {
      operatorId: 'op1',
      issuedAt: new Date(Date.now() - 60_000),
      attempts: 1,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    expect(gw.reconcileNow(new Date())).toEqual([]);
    expect(gw.pendingCount()).toBe(1);
  });

  it('latency samples start empty', () => {
    expect(gw.getLatencySamples()).toEqual([]);
  });

  it('exposes policy version constant', () => {
    expect(COMMAND_DELIVERY_POLICY_VERSION).toBe('command-delivery-v1');
  });
});
