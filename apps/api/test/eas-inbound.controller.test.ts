// apps/api/test/eas-inbound.controller.test.ts
// RED-first for the EAS BUILD webhook receiver -- the OFF-runner completion
// gate that replaces --wait in eas-driver-build.yml. Expo signs the RAW
// request body: expo-signature: sha1=<hex HMAC-SHA1 with the webhook
// secret>, so verification MUST run over req.rawBody (rawBody:true in
// bootstrap), never a re-serialized JSON.stringify(body). errored -> Sentry
// fatal; canceled -> warning; finished -> silent. IDEMPOTENCY: EAS delivers
// at-least-once and retries on non-2xx, so a repeated build id must NOT fire
// a second Sentry alert -- the controller dedups via an injected
// EasBuildDedupPort (markSeen returns false on a repeat). Mirrors
// erp-inbound.controller.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { EasBuildDedupPort } from '../src/eas-inbound/eas-build-dedup.store.js';
const captureMessage = vi.fn();
vi.mock('@sentry/nestjs', () => ({
  captureMessage: (...args: unknown[]) => { captureMessage(...args); },
}));
import { EasInboundController } from '../src/eas-inbound/eas-inbound.controller.js';
const SECRET = 'test-eas-secret'; // pragma: allowlist secret
function sign(raw: Buffer): string {
  return 'sha1=' + createHmac('sha1', SECRET).update(raw).digest('hex');
}
function makeReq(payload: unknown): { rawBody: Buffer; body: unknown } {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  return { rawBody: raw, body: payload };
}
// Test double for the dedup port. Records ids in a Set; markSeen returns true
// the FIRST time an id is seen and false afterwards -- the real SET NX PX
// semantics. seen[] exposes call order for assertions.
function makeDedup(): EasBuildDedupPort & { calls: string[] } {
  const store = new Set<string>();
  const calls: string[] = [];
  return {
    calls,
    markSeen(buildId: string): Promise<boolean> {
      calls.push(buildId);
      if (store.has(buildId)) return Promise.resolve(false);
      store.add(buildId);
      return Promise.resolve(true);
    },
  };
}
// Dedup double that always returns true (isolates non-dedup assertions).
function alwaysFresh(): EasBuildDedupPort {
  return { markSeen: (): Promise<boolean> => Promise.resolve(true) };
}
const ERRORED = {
  id: 'build-err-1',
  appId: 'app-1',
  status: 'errored',
  platform: 'ios',
  error: { message: 'Provisioning boom', errorCode: 'PROVISIONING' },
  futureField: 'kept',
};
const FINISHED = { id: 'build-ok-1', status: 'finished', platform: 'android' };
const CANCELED = { id: 'build-can-1', status: 'canceled', platform: 'ios' };
describe('@fleet/api - EasInboundController', () => {
  let ctl: EasInboundController;
  beforeEach(() => {
    captureMessage.mockClear();
    process.env['EAS_WEBHOOK_SECRET'] = SECRET;
    ctl = new EasInboundController(alwaysFresh());
  });
  it('rejects when signature header is missing', async () => {
    const req = makeReq(FINISHED);
    await expect(ctl.buildStatus(req as never, undefined)).rejects.toThrow(/signature/i);
  });
  it('rejects when EAS_WEBHOOK_SECRET is unset', async () => {
    delete process.env['EAS_WEBHOOK_SECRET'];
    const req = makeReq(FINISHED);
    await expect(ctl.buildStatus(req as never, sign(req.rawBody))).rejects.toThrow(/signature/i);
  });
  it('rejects a bad signature', async () => {
    const req = makeReq(FINISHED);
    await expect(ctl.buildStatus(req as never, 'sha1=' + 'ab'.repeat(20))).rejects.toThrow(/signature/i);
  });
  it('rejects when rawBody is unavailable', async () => {
    await expect(ctl.buildStatus({ body: FINISHED } as never, 'sha1=deadbeef')).rejects.toThrow(/signature|raw/i);
  });
  it('errored build -> Sentry fatal with build facts, returns received', async () => {
    const req = makeReq(ERRORED);
    const res = await ctl.buildStatus(req as never, sign(req.rawBody));
    expect(res).toEqual({ received: true });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = captureMessage.mock.calls[0] as [string, { level: string; extra: Record<string, unknown> }];
    expect(msg).toMatch(/EAS build errored/i);
    expect(ctx.level).toBe('fatal');
    expect(ctx.extra['buildId']).toBe('build-err-1');
    expect(ctx.extra['platform']).toBe('ios');
  });
  it('canceled build -> Sentry warning', async () => {
    const req = makeReq(CANCELED);
    await ctl.buildStatus(req as never, sign(req.rawBody));
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [, ctx] = captureMessage.mock.calls[0] as [string, { level: string }];
    expect(ctx.level).toBe('warning');
  });
  it('finished build passes silently (no Sentry capture)', async () => {
    const req = makeReq(FINISHED);
    const res = await ctl.buildStatus(req as never, sign(req.rawBody));
    expect(res).toEqual({ received: true });
    expect(captureMessage).not.toHaveBeenCalled();
  });
  it('junk payload after a valid signature throws at the Zod boundary', async () => {
    const req = makeReq({ status: 42 });
    await expect(ctl.buildStatus(req as never, sign(req.rawBody))).rejects.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });
  it('idempotency: a repeated errored build id fires Sentry only ONCE', async () => {
    const dedupCtl = new EasInboundController(makeDedup());
    const req = makeReq(ERRORED);
    const sig = sign(req.rawBody);
    const first = await dedupCtl.buildStatus(req as never, sig);
    const second = await dedupCtl.buildStatus(req as never, sig);
    // Both deliveries acknowledged (2xx so EAS stops retrying)...
    expect(first).toEqual({ received: true });
    expect(second).toEqual({ received: true });
    // ...but the fatal is raised only on the first.
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
  it('idempotency: signature is verified BEFORE dedup (bad sig on a repeat still rejects)', async () => {
    const dedup = makeDedup();
    const dedupCtl = new EasInboundController(dedup);
    const req = makeReq(ERRORED);
    await dedupCtl.buildStatus(req as never, sign(req.rawBody));
    await expect(dedupCtl.buildStatus(req as never, 'sha1=' + 'cd'.repeat(20))).rejects.toThrow(/signature/i);
    // markSeen must NOT have been consulted for the unsigned replay.
    expect(dedup.calls).toEqual(['build-err-1']);
  });
  it('wiring guard: main.ts bootstraps with rawBody: true', () => {
    const src = readFileSync('src/main.ts', 'utf8');
    expect(src).toContain('rawBody: true');
  });
  it('wiring guard: app.module registers EasInboundModule', () => {
    const src = readFileSync('src/app.module.ts', 'utf8');
    expect(src).toContain('EasInboundModule');
  });
});
