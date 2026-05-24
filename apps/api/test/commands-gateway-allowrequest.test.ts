// apps/api/test/commands-gateway-allowrequest.test.ts
import { describe, it, expect } from 'vitest';
import { wsAllowRequest } from '../src/commands/commands.gateway.js';
interface FakeReq {
  headers: Record<string, string | undefined>;
  url?: string;
}
type AllowCb = (err: string | null, success: boolean) => void;
describe('@fleet/api - wsAllowRequest pre-upgrade gate', () => {
  it('allows upgrade with no Authorization header (auth payload arrives post-upgrade)', () => {
    const req: FakeReq = { headers: {}, url: '/socket.io/' };
    let outcome: { err: string | null; ok: boolean } | null = null;
    const cb: AllowCb = (err, ok) => { outcome = { err, ok }; };
    wsAllowRequest(req as never, cb);
    expect(outcome).toEqual({ err: null, ok: true });
  });
  it('allows upgrade when Authorization Bearer header is present', () => {
    const req: FakeReq = { headers: { authorization: 'Bearer xyz' }, url: '/socket.io/' };
    let outcome: { err: string | null; ok: boolean } | null = null;
    const cb: AllowCb = (err, ok) => { outcome = { err, ok }; };
    wsAllowRequest(req as never, cb);
    expect(outcome).toEqual({ err: null, ok: true });
  });
  it('rejects upgrade when Authorization header has non-Bearer scheme', () => {
    const req: FakeReq = { headers: { authorization: 'Basic abc' }, url: '/socket.io/' };
    let outcome: { err: string | null; ok: boolean } | null = null;
    const cb: AllowCb = (err, ok) => { outcome = { err, ok }; };
    wsAllowRequest(req as never, cb);
    expect(outcome).toEqual({ err: 'invalid_authorization_scheme', ok: false });
  });
  it('callback receives string error code, never an Error instance (engine.io contract)', () => {
    const req: FakeReq = { headers: { authorization: 'Basic abc' }, url: '/socket.io/' };
    let captured: unknown = undefined;
    const cb: AllowCb = (err) => { captured = err; };
    wsAllowRequest(req as never, cb);
    expect(typeof captured).toBe('string');
    expect(captured instanceof Error).toBe(false);
  });
});
