// apps/api/test/commands-gateway-handleack-otel-pins.test.ts
// Kills line 277 tagActiveSpan outcome ternary mutants in handleAck:
// - false ? ...           -> outcome would be 'ack_received' on rejected ack
// - ack.status === ""     -> outcome would be 'ack_received' on rejected ack
// - 'rejected' ? "" : ... -> outcome would be "" on rejected ack
import { describe, it, expect, vi } from 'vitest';
const setAttrSpy = vi.fn();
vi.mock('../src/observability/otel.js', () => ({
  tagActiveSpan: setAttrSpy,
  recordSpanFailure: vi.fn(),
  shutdownOtel: vi.fn(),
}));
const { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } =
  await import('../src/commands/commands.gateway.js');
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

const cmdId = '11111111-1111-4111-8111-111111111111';
const operatorId = '22222222-2222-4222-8222-222222222222';

function makeGatewayWithPending(): InstanceType<typeof CommandsGateway> {
  const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
  const gw = new CommandsGateway(undefined, fakeClock);
  (gw as unknown as PendingMap).pending.set(cmdId, {
    operatorId,
    issuedAt: new Date('2026-05-02T09:59:55.000Z'),
    attempts: 1,
    pushAttempts: 0,
    pushInFlight: false,
    policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
  });
  return gw;
}

describe('@fleet/api - CommandsGateway handleAck OTel outcome pins', () => {
  it('rejected ack tags span with command.outcome="ack_rejected" (kills line 277 ternary cond mutants + StringLiteral mutants)', () => {
    setAttrSpy.mockClear();
    const gw = makeGatewayWithPending();
    const sock = { id: 's', data: { operatorId } } as never;
    gw.handleAck(
      {
        commandId: cmdId,
        ackedAt: new Date().toISOString(),
        status: 'rejected',
        reasonCode: 'operator_busy',
      },
      sock,
    );
    const calls = setAttrSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    // mutants would emit 'ack_received' (cond flip) or '' (StringLiteral) instead
    expect(calls.some((c) => c['command.outcome'] === 'ack_rejected')).toBe(true);
    expect(calls.some((c) => c['command.outcome'] === 'ack_received')).toBe(false);
    expect(calls.some((c) => c['command.outcome'] === '')).toBe(false);
  });

  it('received ack tags span with command.outcome="ack_received" — never empty string (kills line 277 "ack_received" -> "" StringLiteral)', () => {
    setAttrSpy.mockClear();
    const gw = makeGatewayWithPending();
    const sock = { id: 's', data: { operatorId } } as never;
    gw.handleAck({ commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' }, sock);
    const calls = setAttrSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.some((c) => c['command.outcome'] === 'ack_received')).toBe(true);
    expect(calls.some((c) => c['command.outcome'] === '')).toBe(false);
  });
});
