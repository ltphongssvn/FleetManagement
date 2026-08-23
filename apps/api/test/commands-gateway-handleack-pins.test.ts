// apps/api/test/commands-gateway-handleack-pins.test.ts
// Kills survivors on lines 250-285 in handleAck:
// - 250: invalid ack log template
// - 256: unknown command log template
// - 262: operator mismatch log template + `?? '-'` fallback
// - 271: status ternary (cond + equality + StringLiterals 'rejected'/'ok')
// - 277: tagActiveSpan outcome ternary (cond + StringLiterals 'ack_rejected'/'ack_received')
// - 280: ack.status === 'rejected' branch (cond + equality + StringLiteral + BlockStatement)
// - 283: rejected log template
// - 284: else BlockStatement
// - 285: received log template
import { describe, it, expect, vi } from 'vitest';
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

interface RecordedSample {
  ms: number;
  commandId: string;
  operatorId: string;
  recordedAt: Date;
  status: 'ok' | 'rejected';
}

function makeGateway(): {
  gw: InstanceType<typeof CommandsGateway>;
  warns: string[];
  logs: string[];
  samples: RecordedSample[];
} {
  const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
  const samples: RecordedSample[] = [];
  const recorder = {
    record: (s: RecordedSample) => {
      samples.push(s);
    },
    samples: () => samples,
  };
  const gw = new CommandsGateway(undefined, fakeClock, recorder as never);
  const warns: string[] = [];
  const logs: string[] = [];
  (gw as unknown as { logger: unknown }).logger = {
    warn: (m: unknown) => {
      if (typeof m === 'string') warns.push(m);
    },
    log: (m: unknown) => {
      if (typeof m === 'string') logs.push(m);
    },
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { gw, warns, logs, samples };
}

const cmdId = '11111111-1111-4111-8111-111111111111';
const operatorId = '22222222-2222-4222-8222-222222222222';

function seedPending(gw: InstanceType<typeof CommandsGateway>): void {
  (gw as unknown as PendingMap).pending.set(cmdId, {
    operatorId,
    issuedAt: new Date('2026-05-02T09:59:55.000Z'), // 5s before fake clock
    attempts: 1,
    pushAttempts: 0,
    pushInFlight: false,
    policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
  });
}

describe('@fleet/api - CommandsGateway handleAck pins', () => {
  it('invalid_payload log includes the socket id (kills line 250 StringLiteral template)', () => {
    const { gw, warns } = makeGateway();
    const sock = { id: 'sock-abc', data: { operatorId } } as never;
    const result = gw.handleAck({ garbage: true } as never, sock);
    expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('sock-abc');
  });

  it('unknown_command log includes the commandId (kills line 256 StringLiteral template)', () => {
    const { gw, warns } = makeGateway();
    const sock = { id: 's', data: { operatorId } } as never;
    const result = gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      sock,
    );
    expect(result).toEqual({ ok: false, reason: 'unknown_command' });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(cmdId);
  });

  it('operator_mismatch log includes socket + expected operator + cmd (kills line 262 StringLiteral)', () => {
    const { gw, warns } = makeGateway();
    seedPending(gw);
    const otherOp = '33333333-3333-4333-8333-333333333333';
    const sock = { id: 's', data: { operatorId: otherOp } } as never;
    const result = gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      sock,
    );
    expect(result).toEqual({ ok: false, reason: 'operator_mismatch' });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(otherOp);
    expect(warns[0]).toContain(operatorId);
    expect(warns[0]).toContain(cmdId);
  });

  it('operator_mismatch log uses "-" when socket has no operatorId (kills `?? "-"` LogicalOperator)', () => {
    const { gw, warns } = makeGateway();
    seedPending(gw);
    // socket has no operatorId at all -> falsy -> falls back to '-'
    const sock = { id: 's', data: {} } as never;
    const result = gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      sock,
    );
    expect(result).toEqual({ ok: false, reason: 'operator_mismatch' });
    expect(warns[0]).toContain('socket=-');
  });

  it('records latency sample with status="rejected" on rejected ack (kills line 271 ternary + StringLiterals)', () => {
    const { gw, samples, warns } = makeGateway();
    seedPending(gw);
    const sock = { id: 's', data: { operatorId } } as never;
    const result = gw.handleAck(
      {
        commandId: cmdId,
        ackedAt: new Date().toISOString(),
        status: 'rejected',
        reasonCode: 'operator_busy',
      },
      sock,
    );
    expect(result).toEqual({ ok: true });
    expect(samples).toHaveLength(1);
    const sample = samples[0];
    if (sample === undefined) throw new Error('sample missing');
    expect(sample.status).toBe('rejected');
    // line 283 rejected log includes the command id, reasonCode, latencyMs
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(cmdId);
    expect(warns[0]).toContain('operator_busy');
    expect(warns[0]).toContain('REJECTED');
  });

  it('records latency sample with status="ok" on received ack (kills line 271 ternary other branch + line 285 log)', () => {
    const { gw, samples, logs, warns } = makeGateway();
    seedPending(gw);
    const sock = { id: 's', data: { operatorId } } as never;
    const result = gw.handleAck(
      { commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' },
      sock,
    );
    expect(result).toEqual({ ok: true });
    expect(samples).toHaveLength(1);
    const sample = samples[0];
    if (sample === undefined) throw new Error('sample missing');
    expect(sample.status).toBe('ok');
    // line 284 else block executes -> logger.log fired, NOT logger.warn
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(cmdId);
    expect(logs[0]).toContain('received');
    expect(warns).toHaveLength(0);
  });

  it('rejected branch fires logger.warn AND skips the received log (kills line 280 BlockStatement + line 284 else BlockStatement)', () => {
    const { gw, warns, logs } = makeGateway();
    seedPending(gw);
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
    // mutant "if (rejected) {} else {…}" would skip the warn and instead emit the received log
    expect(warns).toHaveLength(1);
    expect(logs).toHaveLength(0);
  });

  it('received branch fires logger.log AND skips the rejected warn (kills line 280 cond true mutant)', () => {
    const { gw, warns, logs } = makeGateway();
    seedPending(gw);
    const sock = { id: 's', data: { operatorId } } as never;
    gw.handleAck({ commandId: cmdId, ackedAt: new Date().toISOString(), status: 'received' }, sock);
    // mutant "if (true) {…}" would emit the REJECTED warn instead
    expect(logs).toHaveLength(1);
    expect(warns).toHaveLength(0);
  });
});
