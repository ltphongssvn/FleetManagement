// apps/api/test/commands-gateway-misc-pins.test.ts
// Kills remaining survivors on commands.gateway.ts:
// - line 376-378: reconcileAndSettle filter MethodExpression + undefined ConditionalExpression
// - line 391: clearDeadLetters() BlockStatement (NoCoverage)
// - line 395: clearPending() BlockStatement
// - line 160: handleConnection 'IdentityProvider not wired' error StringLiteral
// - line 170: WS missing-token warn template
// - line 180: WS rejection warn template
import { describe, it, expect, vi } from 'vitest';
import {
  CommandsGateway,
  COMMAND_DELIVERY_POLICY_VERSION,
} from '../src/commands/commands.gateway.js';
import type { Clock } from '../src/common/clock.js';
import type { IIdentityProvider } from '../src/auth/identity-provider.interface.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import { OperatorContextFactory } from '../src/auth/operator-context.factory.js';

interface PendingEntry {
  operatorId: string;
  issuedAt: Date;
  attempts: number;
  pushAttempts: number;
  pushInFlight: boolean;
  policyVersion: string;
}
interface PendingMap {
  readonly pending: Map<string, PendingEntry>;
  readonly deadLetters: unknown[];
}

function makeGateway(push?: IPushProvider): {
  gw: InstanceType<typeof CommandsGateway>;
  warns: string[];
  errors: string[];
  fakeClock: Clock;
} {
  const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
  const gw = new CommandsGateway(push, fakeClock);
  const warns: string[] = [];
  const errors: string[] = [];
  (gw as unknown as { logger: unknown }).logger = {
    warn: (m: unknown) => {
      if (typeof m === 'string') warns.push(m);
    },
    log: vi.fn(),
    error: (m: unknown) => {
      if (typeof m === 'string') errors.push(m);
    },
    debug: vi.fn(),
  };
  return { gw, warns, errors, fakeClock };
}

function seedTimedOut(
  gw: InstanceType<typeof CommandsGateway>,
  commandId: string,
  operatorId: string,
  fakeClock: Clock,
): void {
  (gw as unknown as PendingMap).pending.set(commandId, {
    operatorId,
    issuedAt: new Date(fakeClock.now().getTime() - 60_000),
    attempts: 999,
    pushAttempts: 0,
    pushInFlight: false,
    policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
  });
}

describe('@fleet/api - CommandsGateway misc pins', () => {
  it('reconcileAndSettle filter removes flushed ids with no push promise (kills line 376 MethodExpression + line 378 cond mutant via no-provider path)', async () => {
    // No push provider -> reconcileNow returns flushed=[id] but pushPromises stays empty.
    // .map() returns [undefined], filter removes it -> Promise.allSettled([]) -> settled=0.
    // MethodExpression mutant `flushed.map(id => this.pushPromises.get(id))` (drops .filter)
    //   would yield Promise.allSettled([undefined]) -> settled=1.
    // ConditionalExpression mutant `(p) => true` would also yield settled=1.
    const { gw, fakeClock } = makeGateway(undefined);
    seedTimedOut(gw, 'c-no-promise', 'op-np', fakeClock);
    const { flushed, settled } = await gw.reconcileAndSettle();
    expect(flushed).toEqual(['c-no-promise']);
    expect(settled).toBe(0);
  });

  it('reconcileAndSettle settled count reflects actual push promises (kills line 376 MethodExpression keeping filter effect)', async () => {
    // With provider, push promise IS created -> filter keeps it -> settled=1.
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 });
    const { gw, fakeClock } = makeGateway({ sendToOperator: sendSpy });
    seedTimedOut(gw, 'c-has-promise', 'op-hp', fakeClock);
    const { flushed, settled } = await gw.reconcileAndSettle();
    expect(flushed).toEqual(['c-has-promise']);
    expect(settled).toBe(1);
  });

  it('clearDeadLetters() empties the DLQ (kills line 391 BlockStatement NoCoverage mutant)', () => {
    const { gw } = makeGateway(undefined);
    (gw as unknown as PendingMap).deadLetters.push({
      commandId: 'x',
      operatorId: 'o',
      issuedAt: new Date(),
      pushAttempts: 3,
      lastError: 'e',
      deadLetteredAt: new Date(),
    });
    expect(gw.getDeadLetters()).toHaveLength(1);
    gw.clearDeadLetters();
    expect(gw.getDeadLetters()).toHaveLength(0);
  });

  it('clearPending() empties the pending map (kills line 395 BlockStatement)', () => {
    const { gw, fakeClock } = makeGateway(undefined);
    seedTimedOut(gw, 'c-1', 'op-1', fakeClock);
    seedTimedOut(gw, 'c-2', 'op-2', fakeClock);
    expect(gw.pendingCount()).toBe(2);
    gw.clearPending();
    expect(gw.pendingCount()).toBe(0);
  });

  it('handleConnection logs "IdentityProvider not wired" when idp missing (kills line 160 StringLiteral)', async () => {
    // Constructor with no idp + no factory triggers line 160.
    const { gw, errors } = makeGateway(undefined);
    const disconnectSpy = vi.fn();
    const sock = {
      id: 's',
      handshake: { auth: {}, headers: {} },
      disconnect: disconnectSpy,
      data: {},
      join: vi.fn(),
    } as never;
    await gw.handleConnection(sock);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('IdentityProvider');
    expect(errors[0]).toContain('not wired');
  });

  it('handleConnection with idp=undef but factory=defined logs "IdentityProvider not wired" (kills line 159 idp-side cond mutant)', async () => {
    // Mutant `false || factory === undefined` skips the idp guard, falls through to verifyToken on undefined idp,
    // which throws TypeError caught by line 178 catch -> "WS connect rejected" warn (NOT the "not wired" error).
    // Original triggers line 160 error log first.
    const factory = new OperatorContextFactory();
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock, undefined, undefined, factory);
    const warns: string[] = [];
    const errors: string[] = [];
    (gw as unknown as { logger: unknown }).logger = {
      warn: (m: unknown) => {
        if (typeof m === 'string') warns.push(m);
      },
      log: vi.fn(),
      error: (m: unknown) => {
        if (typeof m === 'string') errors.push(m);
      },
      debug: vi.fn(),
    };
    const sock = {
      id: 's',
      handshake: { auth: { token: 'good' }, headers: {} },
      disconnect: vi.fn(),
      data: {},
      join: vi.fn(),
    } as never;
    await gw.handleConnection(sock);
    // Original: error log fires, warn does NOT fire (early return before extractToken).
    // Mutant: error log does NOT fire (guard skipped), warn fires from catch path.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not wired');
    expect(warns).toHaveLength(0);
  });

  it('handleConnection warns with socket id when token missing (kills line 170 StringLiteral template)', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const factory = { fromIdentity: vi.fn() } as unknown as OperatorContextFactory;
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock, undefined, idp, factory);
    const warns: string[] = [];
    (gw as unknown as { logger: unknown }).logger = {
      warn: (m: unknown) => {
        if (typeof m === 'string') warns.push(m);
      },
      log: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const sock = {
      id: 'sock-no-token',
      handshake: { auth: {}, headers: {} },
      disconnect: vi.fn(),
      data: {},
      join: vi.fn(),
    } as never;
    await gw.handleConnection(sock);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('sock-no-token');
    expect(warns[0]).toContain('missing token');
  });

  it('handleConnection warns with error message + socket id when verifyToken throws (kills line 180 StringLiteral template)', async () => {
    const idp: IIdentityProvider = {
      verifyToken: vi.fn().mockRejectedValue(new Error('jwt-malformed')),
    };
    const factory = { fromIdentity: vi.fn() } as unknown as OperatorContextFactory;
    const fakeClock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
    const gw = new CommandsGateway(undefined, fakeClock, undefined, idp, factory);
    const warns: string[] = [];
    (gw as unknown as { logger: unknown }).logger = {
      warn: (m: unknown) => {
        if (typeof m === 'string') warns.push(m);
      },
      log: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const sock = {
      id: 'sock-bad-tok',
      handshake: { auth: { token: 'bad' }, headers: {} },
      disconnect: vi.fn(),
      data: {},
      join: vi.fn(),
    } as never;
    await gw.handleConnection(sock);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('sock-bad-tok');
    expect(warns[0]).toContain('jwt-malformed');
  });
});
