// apps/api/test/eas-inbound.controller.test.ts
// RED-first for the EAS BUILD webhook receiver -- the OFF-runner completion
// gate that replaces --wait in eas-driver-build.yml. Expo signs the RAW
// request body: expo-signature: sha1=<hex HMAC-SHA1 with the webhook
// secret>, so verification MUST run over req.rawBody (rawBody:true in
// bootstrap), never a re-serialized JSON.stringify(body). errored -> Sentry
// fatal (same alerting pattern as the break-glass login monitor); canceled
// -> warning; finished -> silent. Mirrors erp-inbound.controller.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
    ctl = new EasInboundController();
  });

  it('rejects when signature header is missing', () => {
    const req = makeReq(FINISHED);
    expect(() => ctl.buildStatus(req as never, undefined)).toThrow(/signature/i);
  });

  it('rejects when EAS_WEBHOOK_SECRET is unset', () => {
    delete process.env['EAS_WEBHOOK_SECRET'];
    const req = makeReq(FINISHED);
    expect(() => ctl.buildStatus(req as never, sign(req.rawBody))).toThrow(/signature/i);
  });

  it('rejects a bad signature', () => {
    const req = makeReq(FINISHED);
    expect(() => ctl.buildStatus(req as never, 'sha1=' + 'ab'.repeat(20))).toThrow(/signature/i);
  });

  it('rejects when rawBody is unavailable', () => {
    expect(() => ctl.buildStatus({ body: FINISHED } as never, 'sha1=deadbeef')).toThrow(/signature|raw/i);
  });

  it('errored build -> Sentry fatal with build facts, returns received', () => {
    const req = makeReq(ERRORED);
    const res = ctl.buildStatus(req as never, sign(req.rawBody));
    expect(res).toEqual({ received: true });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = captureMessage.mock.calls[0] as [string, { level: string; extra: Record<string, unknown> }];
    expect(msg).toMatch(/EAS build errored/i);
    expect(ctx.level).toBe('fatal');
    expect(ctx.extra['buildId']).toBe('build-err-1');
    expect(ctx.extra['platform']).toBe('ios');
  });

  it('canceled build -> Sentry warning', () => {
    const req = makeReq(CANCELED);
    ctl.buildStatus(req as never, sign(req.rawBody));
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [, ctx] = captureMessage.mock.calls[0] as [string, { level: string }];
    expect(ctx.level).toBe('warning');
  });

  it('finished build passes silently (no Sentry capture)', () => {
    const req = makeReq(FINISHED);
    const res = ctl.buildStatus(req as never, sign(req.rawBody));
    expect(res).toEqual({ received: true });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('junk payload after a valid signature throws at the Zod boundary', () => {
    const req = makeReq({ status: 42 });
    expect(() => ctl.buildStatus(req as never, sign(req.rawBody))).toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
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
