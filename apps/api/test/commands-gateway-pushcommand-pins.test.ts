// apps/api/test/commands-gateway-pushcommand-pins.test.ts
// Kills survivors on lines 201-202 (shutdown inflight log + guard),
// 211 (no-socket warn), 222-225 (tagActiveSpan ObjectLiteral + 'no_socket' StringLiteral),
// 234 (pushInFlight false BooleanLiteral on emit path),
// 243 (emit return ObjectLiteral + 'emitted' StringLiteral).
import { describe, it, expect, vi } from 'vitest';
const setAttrSpy = vi.fn();
vi.mock('../src/observability/otel.js', () => ({
  tagActiveSpan: setAttrSpy,
  recordSpanFailure: vi.fn(),
  shutdownOtel: vi.fn(),
}));
const { CommandsGateway } = await import('../src/commands/commands.gateway.js');
import type { Clock } from '../src/common/clock.js';

interface PushPromiseMap {
  readonly pushPromises: Map<string, Promise<void>>;
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

describe('@fleet/api - CommandsGateway pushCommand pins', () => {
  it('returns status="emitted" with recipientCount and room when socket exists (kills emit return ObjectLiteral + StringLiteral)', () => {
    setAttrSpy.mockClear();
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    const room = 'operator:op-online';
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map([[room, new Set(['s1', 's2'])]]) } },
      to: () => ({ emit: (): void => undefined }),
    };
    const result = gw.pushCommand({
      commandId: 'c-emit-1',
      targetOperatorId: 'op-online',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    // Kills ObjectLiteral {} mutant AND status: '' StringLiteral mutant
    expect(result).toEqual({ status: 'emitted', recipientCount: 2, room });
    expect(result.status).toBe('emitted');
  });

  it('pushInFlight is false on emit-path pending entry (kills pushInFlight true BooleanLiteral)', () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map([['operator:op1', new Set(['s1'])]]) } },
      to: () => ({ emit: (): void => undefined }),
    };
    gw.pushCommand({
      commandId: 'c-flag',
      targetOperatorId: 'op1',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    const entry = (gw as unknown as PushPromiseMap).pending.get('c-flag');
    if (entry === undefined) throw new Error('pending entry missing');
    // If mutated to true, reconciler overlap protection would skip the very first push attempt.
    expect(entry.pushInFlight).toBe(false);
  });

  it('no_socket path: tagActiveSpan receives all 3 fields including outcome="no_socket" (kills ObjectLiteral {} and "no_socket" StringLiteral)', () => {
    setAttrSpy.mockClear();
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map() } }, // empty room
      to: () => ({ emit: (): void => undefined }),
    };
    gw.pushCommand({
      commandId: 'c-no-sock',
      targetOperatorId: 'op-offline',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    expect(setAttrSpy).toHaveBeenCalledWith({
      'command.id': 'c-no-sock',
      'command.target_operator': 'op-offline',
      'command.outcome': 'no_socket',
    });
  });

  it('no_socket path: logs the room and commandId (kills line 211 logger.warn template StringLiteral)', () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    const warnSpy = vi.fn();
    (gw as unknown as { logger: unknown }).logger = {
      warn: warnSpy,
      log: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    (gw as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map() } },
      to: () => ({ emit: (): void => undefined }),
    };
    gw.pushCommand({
      commandId: 'c-warn',
      targetOperatorId: 'op-warn',
      type: 'noop',
      payload: {},
      issuedAt: new Date().toISOString(),
    } as never);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0]?.[0];
    if (typeof msg !== 'string') throw new Error('expected log string');
    expect(msg).toContain('operator:op-warn');
    expect(msg).toContain('c-warn');
  });

  it('onModuleDestroy logs "Awaiting N in-flight push fallback(s)" template (kills line 202 StringLiteral)', async () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    const logSpy = vi.fn();
    (gw as unknown as { logger: unknown }).logger = {
      warn: vi.fn(),
      log: logSpy,
      error: vi.fn(),
      debug: vi.fn(),
    };
    // Seed pushPromises so inflight.length === 1
    let resolveIt: () => void = () => undefined;
    const p = new Promise<void>((res) => {
      resolveIt = res;
    });
    (gw as unknown as PushPromiseMap).pushPromises.set('c-await', p);
    const destroyPromise = gw.onModuleDestroy();
    resolveIt();
    await destroyPromise;
    expect(logSpy).toHaveBeenCalledOnce();
    const msg = logSpy.mock.calls[0]?.[0];
    if (typeof msg !== 'string') throw new Error('expected log string');
    expect(msg).toContain('Awaiting');
    expect(msg).toContain('1');
    expect(msg).toContain('in-flight');
  });

  it('onModuleDestroy DOES await inflight push promises (kills line 201 ConditionalExpression false guard)', async () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    let resolved = false;
    let resolveIt: () => void = () => undefined;
    const p = new Promise<void>((res) => {
      resolveIt = () => {
        resolved = true;
        res();
      };
    });
    (gw as unknown as PushPromiseMap).pushPromises.set('c-pending', p);
    // If mutant flips guard to "if (false) return", destroy still proceeds; but
    // line 201 mutant is "if (false) return" (skip early-return), real code still awaits.
    // The strict pin: when inflight is non-empty, destroy must NOT resolve until
    // the inflight promise resolves.
    let destroyResolved = false;
    const destroyPromise = gw.onModuleDestroy().then(() => {
      destroyResolved = true;
    });
    // Give the event loop a tick — destroyPromise must still be pending
    await Promise.resolve();
    await Promise.resolve();
    expect(destroyResolved).toBe(false);
    resolveIt();
    await destroyPromise;
    expect(resolved).toBe(true);
    expect(destroyResolved).toBe(true);
  });

  it('onModuleDestroy with zero inflight does NOT log the "Awaiting" message (kills line 201 ConditionalExpression false guard from the other side)', async () => {
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock);
    const logSpy = vi.fn();
    (gw as unknown as { logger: unknown }).logger = {
      warn: vi.fn(),
      log: logSpy,
      error: vi.fn(),
      debug: vi.fn(),
    };
    // No pushPromises seeded; inflight.length === 0
    await gw.onModuleDestroy();
    // Mutant "if (false) return" would proceed to log + allSettled even with empty array.
    expect(logSpy).not.toHaveBeenCalled();
  });
});
