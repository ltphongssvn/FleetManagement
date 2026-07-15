// apps/dispatcher-app/test/session-manager.test.ts
// RED-first spec for DispatcherSessionManager (T17 V10c-auth). Hybrid of
// two proven patterns: the driver-app token LIFECYCLE (skew-aware pre-
// refresh, single-flight, port-injected storage + clock, fail-closed on
// 401/403, fail-open on transport error) with the ops-web KEYCLOAK refresh
// contract (grant_type=refresh_token, x-www-form-urlencoded, direct to the
// token endpoint) -- because a native passkey session holds tokens in
// SecureStore (no httpOnly cookies) and rotates at Keycloak, not the api.
// getAccessToken is the getToken seam the copilot client consumes. Written
// before src/auth/session-manager.ts exists.
import { describe, expect, it, vi } from 'vitest';
import {
  DispatcherSessionManager,
  NotAuthenticatedError,
  SessionExpiredError,
  type DispatcherStoredToken,
  type DispatcherSessionStoragePort,
} from '../src/auth/session-manager.js';
const ENV = { tokenEndpoint: 'https://idp.fleet.test/token', clientId: 'dispatcher-app' };
type MockStorage = DispatcherSessionStoragePort & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};
function memStorage(initial: DispatcherStoredToken | null): MockStorage {
  let held = initial;
  return {
    load: vi.fn(() => Promise.resolve(held)),
    save: vi.fn((t: DispatcherStoredToken) => { held = t; return Promise.resolve(); }),
    clear: vi.fn(() => { held = null; return Promise.resolve(); }),
  };
}
function tokenBody(access: string, refresh: string, expiresIn: number): unknown {
  return { access_token: access, refresh_token: refresh, expires_in: expiresIn };
}
function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const FRESH: DispatcherStoredToken = { accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 10_000 };
describe('@fleet/dispatcher-app DispatcherSessionManager', () => {
  it('returns the stored access token when it is comfortably unexpired', async () => {
    const fetchFn = vi.fn();
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage: memStorage(FRESH), nowMs: () => 1_000_000 });
    const tok = await mgr.getAccessToken();
    expect(tok).toBe('a-old');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('throws NotAuthenticatedError when storage is empty', async () => {
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn: vi.fn(), storage: memStorage(null), nowMs: () => 0 });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
  it('refreshes within the skew window at the Keycloak endpoint and stores the rotated pair', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(200, tokenBody('a-new', 'r-new', 300))));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    const tok = await mgr.getAccessToken();
    expect(tok).toBe('a-new');
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(ENV.tokenEndpoint);
    expect((call[1].headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(call[1].body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('r-old');
    expect(params.get('client_id')).toBe('dispatcher-app');
  });
  it('shares one in-flight refresh across concurrent callers (single-flight)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(200, tokenBody('a-new', 'r-new', 300))));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    const [t1, t2] = await Promise.all([mgr.getAccessToken(), mgr.getAccessToken()]);
    expect(t1).toBe('a-new');
    expect(t2).toBe('a-new');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('fails closed on 401: clears storage and throws SessionExpiredError', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(401, {})));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.clear).toHaveBeenCalled();
  });
  it('fails open on a transport error: keeps storage for retry', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await expect(mgr.getAccessToken()).rejects.toThrow();
    expect(storage.clear).not.toHaveBeenCalled();
  });
  it('reuses the refresh token when Keycloak omits a rotated one', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(200, { access_token: 'a-new', expires_in: 300 })));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-keep', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await mgr.getAccessToken();
    const saved = storage.save.mock.calls[0]?.[0] as DispatcherStoredToken;
    expect(saved.refreshToken).toBe('r-keep');
  });
  it('clears storage on a malformed 200 body (fail closed)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(200, { nonsense: true })));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.clear).toHaveBeenCalled();
  });
  it('defaults the clock to Date.now when nowMs is not injected', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const fetchFn = vi.fn();
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage: memStorage({ accessToken: 'a-live', refreshToken: 'r', expiresAt: future }) });
    const tok = await mgr.getAccessToken();
    expect(tok).toBe('a-live');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('fails closed on 403 exactly as it does on 401', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(403, {})));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.clear).toHaveBeenCalled();
  });
  it('falls back to a 300s lifetime when Keycloak omits expires_in', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(200, { access_token: 'a-new', refresh_token: 'r-new' })));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await mgr.getAccessToken();
    const saved = storage.save.mock.calls[0]?.[0] as DispatcherStoredToken;
    expect(saved.expiresAt).toBe(1000 + 300);
  });
  it('throws SessionExpiredError on a non-auth HTTP failure without clearing storage', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes(503, {})));
    const storage = memStorage({ accessToken: 'a-old', refreshToken: 'r-old', expiresAt: 1015 });
    const mgr = new DispatcherSessionManager({ env: ENV, fetchFn, storage, nowMs: () => 1_000_000 });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.clear).not.toHaveBeenCalled();
  });
});
