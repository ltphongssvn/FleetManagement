// apps/api/test/eas-inbound.controller.test.ts
// RED-first for the EAS BUILD webhook receiver -- the OFF-runner completion
// gate that replaces --wait in eas-driver-build.yml. Expo signs the RAW
// request body: expo-signature: sha1=<hex HMAC-SHA1 with the webhook
// secret>, so verification MUST run over req.rawBody (rawBody:true in
// bootstrap), never a re-serialized JSON.stringify(body). errored -> Sentry
// fatal; canceled -> warning; finished -> STRUCTURED LOG carrying the
// installable artifact URL (never Sentry: success in the error channel is
// alert fatigue). IDEMPOTENCY: EAS delivers
// at-least-once and retries on non-2xx, so a repeated build id must NOT fire
// a second Sentry alert -- the controller dedups via an injected
// EasBuildDedupPort (markSeen returns false on a repeat). Mirrors
// erp-inbound.controller.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { EasBuildDedupPort } from '../src/eas-inbound/eas-build-dedup.store.js';
const captureMessage = vi.fn();
vi.mock('@sentry/nestjs', () => ({
  captureMessage: (...args: unknown[]) => { captureMessage(...args); },
}));
import { EasInboundController } from '../src/eas-inbound/eas-inbound.controller.js';
import type { ConfigService } from '@nestjs/config';
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
// Capture what the controller logs WITHOUT reaching into its private field.
// Spying on Logger.prototype is both lint-clean (no bracket access to a
// private member) and less coupled: it survives the controller renaming or
// re-scoping its logger, which an instance-level spy would not.
function captureLogs(): { lines: Record<string, unknown>[]; restore: () => void } {
  const lines: Record<string, unknown>[] = [];
  const spy = vi
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((v: unknown) => { lines.push(v as Record<string, unknown>); });
  return { lines, restore: (): void => { spy.mockRestore(); } };
}

// Dedup double that always returns true (isolates non-dedup assertions).
function alwaysFresh(): EasBuildDedupPort {
  return { markSeen: (): Promise<boolean> => Promise.resolve(true) };
}
// ConfigService stub: returns the validated EAS_WEBHOOK_SECRET (Factor III).
// makeConfigWith(undefined) models an environment that never wired the secret;
// makeConfig() is the default (secret present). A separate no-arg wrapper avoids
// the default-parameter trap where passing undefined would re-apply the default.
function makeConfigWith(secret: string | undefined): ConfigService {
  return { get: (key: string): unknown => (key === 'EAS_WEBHOOK_SECRET' ? secret : undefined) } as ConfigService;
}
function makeConfig(): ConfigService {
  return makeConfigWith(SECRET);
}
const ERRORED = {
  id: 'build-err-1',
  appId: 'app-1',
  status: 'errored',
  platform: 'ios',
  error: { message: 'Provisioning boom', errorCode: 'PROVISIONING' },
  futureField: 'kept',
};
const FINISHED = {
  id: 'build-ok-1',
  status: 'finished',
  platform: 'android',
  artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/EXAMPLE.apk' },
  metadata: { appVersion: '1.4.0', buildProfile: 'preview' },
  buildDetailsPageUrl: 'https://expo.dev/accounts/acct/projects/p/builds/build-ok-1',
};
// A finished build with NO downloadable artifact -- Expo omits artifacts for
// some platform/profile combinations, and that must log as null rather than
// throw or vanish.
const FINISHED_NO_ARTIFACT = { id: 'build-ok-2', status: 'finished', platform: 'ios' };
const CANCELED = { id: 'build-can-1', status: 'canceled', platform: 'ios' };
describe('@fleet/api - EasInboundController', () => {
  let ctl: EasInboundController;
  beforeEach(() => {
    captureMessage.mockClear();
    ctl = new EasInboundController(alwaysFresh(), makeConfig());
  });
  it('rejects when signature header is missing', async () => {
    const req = makeReq(FINISHED);
    await expect(ctl.buildStatus(req as never, undefined)).rejects.toThrow(/signature/i);
  });
  it('rejects (fail-closed) when EAS_WEBHOOK_SECRET is unset in config', async () => {
    const noSecretCtl = new EasInboundController(alwaysFresh(), makeConfigWith(undefined));
    const req = makeReq(FINISHED);
    await expect(noSecretCtl.buildStatus(req as never, sign(req.rawBody))).rejects.toThrow(/signature/i);
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
  // WAS: 'finished build passes silently'. It no longer does -- the silent 200
  // discarded artifacts.buildUrl, the one link the drivers need to install an
  // OTA-capable binary, leaving distribution as a manual dashboard visit.
  it('finished build logs the installable artifact URL, and raises NO Sentry event', async () => {
    const { lines: logged, restore } = captureLogs();
    const req = makeReq(FINISHED);
    const res = await ctl.buildStatus(req as never, sign(req.rawBody));
    expect(res).toEqual({ received: true });
    // Success must never reach the ERROR channel.
    expect(captureMessage).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      event: 'eas.build.finished',
      buildId: 'build-ok-1',
      platform: 'android',
      buildProfile: 'preview',
      appVersion: '1.4.0',
      installUrl: 'https://expo.dev/artifacts/eas/EXAMPLE.apk',
    });
    restore();
  });

  it('finished build with no artifact logs installUrl as null, not absent', async () => {
    const { lines: logged, restore } = captureLogs();
    const req = makeReq(FINISHED_NO_ARTIFACT);
    await ctl.buildStatus(req as never, sign(req.rawBody));
    expect(logged).toHaveLength(1);
    // null, not undefined: an absent KEY is indistinguishable from a delivery
    // that never arrived, while an explicit null says "we heard, there was
    // nothing to install".
    expect(logged[0]).toHaveProperty('installUrl', null);
    restore();
  });

  it('idempotency: a repeated finished build logs only ONCE', async () => {
    const dedupCtl = new EasInboundController(makeDedup(), makeConfig());
    const { lines: logged, restore } = captureLogs();
    const req = makeReq(FINISHED);
    const sig = sign(req.rawBody);
    await dedupCtl.buildStatus(req as never, sig);
    await dedupCtl.buildStatus(req as never, sig);
    expect(logged).toHaveLength(1);
    restore();
  });
  it('junk payload after a valid signature throws at the Zod boundary', async () => {
    const req = makeReq({ status: 42 });
    await expect(ctl.buildStatus(req as never, sign(req.rawBody))).rejects.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });
  it('idempotency: a repeated errored build id fires Sentry only ONCE', async () => {
    const dedupCtl = new EasInboundController(makeDedup(), makeConfig());
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
    const dedupCtl = new EasInboundController(dedup, makeConfig());
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
