// apps/api/test/command-push-zero-accepted.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } from '../src/commands/commands.gateway.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';

interface PendingMap {
  readonly pending: Map<string, { operatorId: string; issuedAt: Date; attempts: number; pushAttempts: number; pushInFlight: boolean; policyVersion: string }>;
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

describe('@fleet/api - push result.accepted=0 treated as failure', () => {
  it('retains pending when accepted=0 rejected>0 (all tokens rejected)', async () => {
    const allRejected = vi.fn().mockResolvedValue({ accepted: 0, rejected: 1 }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: allRejected }, fakeClock);
    seed(gw, 'cZero');
    gw.reconcileNow(new Date());
    await gw.pendingPushPromise('cZero');
    expect(gw.pendingCount()).toBe(1);
    const entry = (gw as unknown as PendingMap).pending.get('cZero');
    expect(entry?.pushAttempts).toBe(1);
  });

  it('DLQ after MAX attempts when accepted always 0', async () => {
    const allRejected = vi.fn().mockResolvedValue({ accepted: 0, rejected: 1 }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: allRejected }, fakeClock);
    seed(gw, 'cZeroDLQ');
    for (let i = 0; i < 3; i++) {
      gw.reconcileNow(new Date());
      await gw.pendingPushPromise('cZeroDLQ');
    }
    expect(gw.pendingCount()).toBe(0);
    expect(gw.getDeadLetters().map((d) => d.commandId)).toEqual(['cZeroDLQ']);
  });

  it('still deletes pending on accepted>0 even with rejected>0 (partial success)', async () => {
    const partial = vi.fn().mockResolvedValue({ accepted: 1, rejected: 1 }) as unknown as IPushProvider['sendToOperator'];
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway({ sendToOperator: partial }, fakeClock);
    seed(gw, 'cPartial');
    gw.reconcileNow(new Date());
    await gw.pendingPushPromise('cPartial');
    expect(gw.pendingCount()).toBe(0);
  });
});
