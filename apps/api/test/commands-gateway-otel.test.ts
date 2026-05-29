// apps/api/test/commands-gateway-otel.test.ts
import { describe, it, expect, vi } from 'vitest';

const setAttrSpy = vi.fn();
vi.mock('../src/observability/otel.js', () => ({
  tagActiveSpan: setAttrSpy,
  setSpanFailure: vi.fn(),
  shutdownOtel: vi.fn(),
}));

const { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } = await import('../src/commands/commands.gateway.js');
import type { Clock } from '../src/common/clock.js';

interface PendingMap {
  readonly pending: Map<string, { operatorId: string; issuedAt: Date; attempts: number; pushAttempts: number; pushInFlight: boolean; policyVersion: string }>;
}

describe('@fleet/api - CommandsGateway OTel attributes', () => {
  it('attaches command.id + command.target_operator on pushCommand active span', () => {
    setAttrSpy.mockClear();
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map([['operator:op1', new Set(['s1'])]]) } },
      to: () => ({ emit: (): void => undefined }),
    };
    gw.pushCommand({
      commandId: 'c-otel-1',
      targetOperatorId: 'op1',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    expect(setAttrSpy).toHaveBeenCalledWith({
      'command.id': 'c-otel-1',
      'command.target_operator': 'op1',
      'command.outcome': 'emitted',
    });
  });

  it('attaches command.outcome=ack_received on successful ack', () => {
    setAttrSpy.mockClear();
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    const cmdId = '11111111-1111-4111-8111-111111111111';
    const operatorId = '22222222-2222-4222-8222-222222222222';
    (gw as unknown as PendingMap).pending.set(cmdId, {
      operatorId,
      issuedAt: new Date('2026-05-01T10:00:00.000Z'),
      attempts: 1,
      pushAttempts: 0,
      pushInFlight: false,
      policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
    });
    const fakeSocket = { id: 's', data: { operatorId } } as never;
    gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      fakeSocket,
    );
    const calls = setAttrSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.some((c) => c['command.outcome'] === 'ack_received')).toBe(true);
  });
});
