// apps/api/test/commands-gateway-reconcile-push-pins.test.ts
// Kills survivors on lines 301-361 in reconciler push fallback:
// - 301: timed-out warn template
// - 305-308: sendToOperator ObjectLiteral + title/body StringLiterals + data ObjectLiteral
// - 314: result.rejected > 0 cluster (cond true/false + equality >=/<=)
// - 314: BlockStatement when result.rejected > 0
// - 315: partial-success warn template
// - 321: errMsg `accepted=0 rejected=N` template
// - 332: DLQ error template (accepted=0 path)
// - 333: else BlockStatement (all-rejected retain path)
// - 334: all-rejected warn template
// - 351: DLQ error template (catch path)
// - 352: else BlockStatement (push-failed retain path)
// - 353: push-failed warn template
// - 361: no-provider else BlockStatement (drop from pending)
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway, COMMAND_DELIVERY_POLICY_VERSION } from '../src/commands/commands.gateway.js';
import type { IPushProvider, PushBody, PushSendResult } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';

interface PendingEntry { operatorId: string; issuedAt: Date; attempts: number; pushAttempts: number; pushInFlight: boolean; policyVersion: string }
interface PendingMap { readonly pending: Map<string, PendingEntry> }

const COMMAND_PUSH_MAX_ATTEMPTS = 3; // from commands.gateway.ts

function makeGateway(push: IPushProvider | undefined): {
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
    warn: (m: unknown) => { if (typeof m === 'string') warns.push(m); },
    log: vi.fn(),
    error: (m: unknown) => { if (typeof m === 'string') errors.push(m); },
    debug: vi.fn(),
  };
  return { gw, warns, errors, fakeClock };
}

function seedTimedOut(gw: InstanceType<typeof CommandsGateway>, commandId: string, operatorId: string, fakeClock: Clock, pushAttempts = 0): void {
  (gw as unknown as PendingMap).pending.set(commandId, {
    operatorId,
    issuedAt: new Date(fakeClock.now().getTime() - 60_000), // 60s ago -> timed out
    attempts: 999, // ensure at max so push fallback fires
    pushAttempts,
    pushInFlight: false,
    policyVersion: COMMAND_DELIVERY_POLICY_VERSION,
  });
}

describe('@fleet/api - CommandsGateway reconcile push fallback pins', () => {
  it('timed-out warn includes commandId and attempt count (kills line 301 StringLiteral template)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, warns, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-timeout', 'op-1', fakeClock);
    gw.reconcileNow();
    expect(warns.some((w) => w.includes('c-timeout') && w.includes('999'))).toBe(true);
    await gw.pendingPushPromise('c-timeout');
  });

  it('sendToOperator called with full body shape: title, body, data.commandId (kills lines 305-308 ObjectLiterals + StringLiterals)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-body', 'op-body', fakeClock);
    gw.reconcileNow();
    await gw.pendingPushPromise('c-body');
    expect(sendSpy).toHaveBeenCalledOnce();
    const call = sendSpy.mock.calls[0];
    if (call === undefined) throw new Error('expected send call');
    const [opId, body] = call as [string, PushBody];
    expect(opId).toBe('op-body');
    // ObjectLiteral mutant -> {} would fail all four below
    expect(body.title).toBe('Pending command');
    expect(body.body).toContain('c-body');
    expect(body.body).toContain('requires attention');
    expect(body.data).toEqual({ commandId: 'c-body' });
  });

  it('partial-success (accepted>0 rejected>0): deletes from pending AND emits partial warn (kills line 314 cond/equality + BlockStatement + line 315 template)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 2, rejected: 1 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, warns, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-partial', 'op-p', fakeClock);
    gw.reconcileNow();
    await gw.pendingPushPromise('c-partial');
    expect(gw.pendingCount()).toBe(0);
    // line 315 partial-success warn template carries accepted/rejected counts
    const partial = warns.find((w) => w.includes('Push fallback partial'));
    expect(partial).toBeDefined();
    expect(partial).toContain('2');
    expect(partial).toContain('1');
  });

  it('clean success (accepted>0 rejected=0): deletes from pending and does NOT emit partial warn (kills line 314 cond true mutant)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, warns, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-clean', 'op-c', fakeClock);
    gw.reconcileNow();
    await gw.pendingPushPromise('c-clean');
    expect(gw.pendingCount()).toBe(0);
    // if cond mutated to true, partial warn would fire for clean success
    expect(warns.some((w) => w.includes('partial'))).toBe(false);
  });

  it('accepted=0 below MAX: retains pending, emits all-rejected retry warn with errMsg (kills line 321 + 333 BlockStatement + 334 template)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 0, rejected: 5 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, warns, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-allrej', 'op-r', fakeClock, 0); // pushAttempts=0, will become 1 after
    gw.reconcileNow();
    await gw.pendingPushPromise('c-allrej');
    expect(gw.pendingCount()).toBe(1); // retained, not DLQ'd
    const retry = warns.find((w) => w.includes('all-rejected') && w.includes('c-allrej'));
    expect(retry).toBeDefined();
    expect(retry).toContain('1'); // pushAttempts now 1
    expect(retry).toContain('3'); // COMMAND_PUSH_MAX_ATTEMPTS
  });

  it('accepted=0 at MAX: DLQs and emits DLQ error with errMsg (kills line 321 errMsg template + line 332 DLQ template)', async () => {
    const sendSpy = vi.fn().mockResolvedValue({ accepted: 0, rejected: 7 } as PushSendResult);
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, errors, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-dlq', 'op-dlq', fakeClock, COMMAND_PUSH_MAX_ATTEMPTS - 1); // one more attempt triggers DLQ
    gw.reconcileNow();
    await gw.pendingPushPromise('c-dlq');
    expect(gw.pendingCount()).toBe(0);
    expect(gw.getDeadLetters().length).toBe(1);
    const dlq = errors.find((e) => e.includes('DLQ') && e.includes('c-dlq'));
    expect(dlq).toBeDefined();
    // errMsg template "accepted=0 rejected=N"
    expect(dlq).toContain('accepted=0');
    expect(dlq).toContain('rejected=7');
  });

  it('push rejection below MAX: retains pending, emits push-failed retry warn (kills line 352 BlockStatement + 353 template)', async () => {
    const sendSpy = vi.fn().mockRejectedValue(new Error('network down'));
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, warns, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-fail', 'op-f', fakeClock, 0);
    gw.reconcileNow();
    await gw.pendingPushPromise('c-fail');
    expect(gw.pendingCount()).toBe(1);
    const retry = warns.find((w) => w.includes('Push fallback failed') && w.includes('c-fail'));
    expect(retry).toBeDefined();
    expect(retry).toContain('1');
    expect(retry).toContain('3');
  });

  it('push rejection at MAX: DLQs with error message captured (kills line 351 DLQ error template)', async () => {
    const sendSpy = vi.fn().mockRejectedValue(new Error('upstream 500'));
    const push: IPushProvider = { sendToOperator: sendSpy };
    const { gw, errors, fakeClock } = makeGateway(push);
    seedTimedOut(gw, 'c-final', 'op-final', fakeClock, COMMAND_PUSH_MAX_ATTEMPTS - 1);
    gw.reconcileNow();
    await gw.pendingPushPromise('c-final');
    expect(gw.pendingCount()).toBe(0);
    expect(gw.getDeadLetters().length).toBe(1);
    const dlq = errors.find((e) => e.includes('DLQ') && e.includes('c-final'));
    expect(dlq).toBeDefined();
    expect(dlq).toContain('upstream 500');
  });

  it('no push provider: drops command from pending (kills line 361 else BlockStatement)', () => {
    const { gw, fakeClock } = makeGateway(undefined); // no provider
    seedTimedOut(gw, 'c-noprov', 'op-np', fakeClock);
    expect(gw.pendingCount()).toBe(1);
    gw.reconcileNow();
    // line 361: this.pending.delete(commandId)
    expect(gw.pendingCount()).toBe(0);
  });
});
