// apps/driver-app/test/session-manager.test.ts
// Phase 4.3 RED (driver-app-security arc): framework-free driver session
// manager -- the single owner of the rotated pair on-device. Ports injected
// (fetchFn + storage) so every path is provable without React or SecureStore.
// Laws pinned: SSOT parsing at the wire boundary (login + refresh), skew-aware
// pre-refresh, SINGLE-FLIGHT rotation (concurrent callers share one POST),
// fail-closed session expiry (401/403 clears storage), fail-OPEN on network
// errors (retryable, storage kept), logout best-effort revoke + always clear.
import { describe, expect, it, vi } from 'vitest';
import {
  SessionManager,
  NotAuthenticatedError,
  SessionExpiredError,
  type SessionStoragePort,
} from '../src/auth/session-manager.js';
import type { StoredToken } from '../src/auth/token-storage.js';

const NOW_MS = Date.parse('2026-07-06T12:00:00Z');
const API = 'http://api.test';

function memStorage(initial: StoredToken | null): SessionStoragePort & { current: StoredToken | null } {
  const box = {
    current: initial,
    load(): Promise<StoredToken | null> { return Promise.resolve(box.current); },
    save(t: StoredToken): Promise<void> { box.current = t; return Promise.resolve(); },
    clear(): Promise<void> { box.current = null; return Promise.resolve(); },
  };
  return box;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LIVE: StoredToken = { accessToken: 'live.jwt', refreshToken: 'rt-1', expiresAt: Math.floor(NOW_MS / 1000) + 600 };
const NEAR_EXPIRY: StoredToken = { accessToken: 'old.jwt', refreshToken: 'rt-1', expiresAt: Math.floor(NOW_MS / 1000) + 10 };
const ROTATED = { accessToken: 'new.jwt', refreshToken: 'rt-2', expiresIn: 900 };
const LOGIN_OK = {
  accessToken: 'login.jwt',
  refreshToken: 'rt-login',
  expiresIn: 900,
  driver: { driverId: '3b241101-e2bb-4255-8caf-4136c566a962', operatorId: '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c' },
};

describe('SessionManager.getAccessToken', () => {
  it('returns the stored access token untouched when comfortably before expiry', async () => {
    const storage = memStorage(LIVE);
    const fetchFn = vi.fn();
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).resolves.toBe('live.jwt');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws NotAuthenticatedError when nothing is stored', async () => {
    const storage = memStorage(null);
    const sm = new SessionManager({ apiUrl: API, fetchFn: vi.fn() as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('pre-refreshes inside the skew window: posts the stored refresh token, saves the rotated pair', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, ROTATED));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).resolves.toBe('new.jwt');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const bodyText = typeof init.body === 'string' ? init.body : '';
    expect(url).toBe(API + '/auth/refresh');
    expect(JSON.parse(bodyText)).toEqual({ refreshToken: 'rt-1' });
    expect(storage.current).toEqual({ accessToken: 'new.jwt', refreshToken: 'rt-2', expiresAt: Math.floor(NOW_MS / 1000) + 900 });
  });

  it('single-flight: concurrent callers during expiry share exactly one refresh POST', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    let release: (r: Response) => void = () => undefined;
    const gate = new Promise<Response>((res) => { release = res; });
    const fetchFn = vi.fn().mockReturnValue(gate);
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    const p1 = sm.getAccessToken();
    const p2 = sm.getAccessToken();
    release(jsonResponse(200, ROTATED));
    await expect(Promise.all([p1, p2])).resolves.toEqual(['new.jwt', 'new.jwt']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refresh 401 (reuse/expired server-side) clears storage and throws SessionExpiredError', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { title: 'unauthorized', status: 401 }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.current).toBeNull();
  });

  it('refresh network failure keeps storage (retryable) and rethrows the network error', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).rejects.toBeInstanceOf(TypeError);
    expect(storage.current).toEqual(NEAR_EXPIRY);
  });

  it('forceRefresh rotates even when the access token is still comfortably live', async () => {
    const storage = memStorage(LIVE);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, ROTATED));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken({ forceRefresh: true })).resolves.toBe('new.jwt');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refresh HTTP 500 (non-401/403) throws SessionExpiredError but KEEPS storage (retryable)', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(500, { title: 'boom', status: 500 }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.current).toEqual(NEAR_EXPIRY);
  });

  it('refresh 200 with a non-SSOT body fails CLOSED: clears storage and throws SessionExpiredError', async () => {
    const storage = memStorage(NEAR_EXPIRY);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { accessToken: 'x', expiresIn: 900 }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storage.current).toBeNull();
  });
});

describe('SessionManager.login', () => {
  it('ok: posts credentials, parses the SSOT body, persists the pair with derived expiresAt', async () => {
    const storage = memStorage(null);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, LOGIN_OK));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    const out = await sm.login('0901234567', 'pw');
    expect(out).toEqual({ kind: 'ok' });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const bodyText = typeof init.body === 'string' ? init.body : '';
    expect(url).toBe(API + '/auth/login');
    expect(JSON.parse(bodyText)).toEqual({ phone: '0901234567', password: 'pw' });  // pragma: allowlist secret
    expect(storage.current).toEqual({ accessToken: 'login.jwt', refreshToken: 'rt-login', expiresAt: Math.floor(NOW_MS / 1000) + 900 });
  });

  it('401 resolves invalid-credentials and stores nothing', async () => {
    const storage = memStorage(null);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { title: 'unauthorized', status: 401 }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.login('0901234567', 'bad')).resolves.toEqual({ kind: 'invalid-credentials' });
    expect(storage.current).toBeNull();
  });

  it('non-SSOT 200 body (legacy access-only server) fails CLOSED as protocol-error, stores nothing', async () => {
    const storage = memStorage(null);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { accessToken: 'only.jwt', driver: LOGIN_OK.driver }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.login('0901234567', 'pw')).resolves.toEqual({ kind: 'protocol-error' });
    expect(storage.current).toBeNull();
  });

  it('http 500 resolves http-error with the status for the presenter', async () => {
    const storage = memStorage(null);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(500, { title: 'boom', status: 500 }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.login('0901234567', 'pw')).resolves.toEqual({ kind: 'http-error', status: 500 });
    expect(storage.current).toBeNull();
  });
});

describe('SessionManager.logout', () => {
  it('best-effort revokes server-side with the stored refresh token, then clears', async () => {
    const storage = memStorage(LIVE);
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { revoked: true }));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await sm.logout();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const bodyText = typeof init.body === 'string' ? init.body : '';
    expect(url).toBe(API + '/auth/logout');
    expect(JSON.parse(bodyText)).toEqual({ refreshToken: 'rt-1' });
    expect(storage.current).toBeNull();
  });

  it('clears local storage even when the revoke POST throws (offline logout)', async () => {
    const storage = memStorage(LIVE);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.logout()).resolves.toBeUndefined();
    expect(storage.current).toBeNull();
  });

  it('with nothing stored, logout is a no-op that never posts', async () => {
    const storage = memStorage(null);
    const fetchFn = vi.fn();
    const sm = new SessionManager({ apiUrl: API, fetchFn: fetchFn as never, storage, nowMs: () => NOW_MS });
    await expect(sm.logout()).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
