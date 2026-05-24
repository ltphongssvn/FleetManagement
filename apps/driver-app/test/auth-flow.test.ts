// apps/driver-app/test/auth-flow.test.ts
import { describe, it, expect, vi } from 'vitest';
import { exchangeAuthCode, isTokenExpired } from '../src/auth/auth-flow.js';

describe('@fleet/driver-app - exchangeAuthCode', () => {
  it('returns access+refresh on 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    });
    const res = await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token',
      code: 'C',
      clientId: 'cid',
      redirectUri: 'fleetdriver://cb',
      fetchFn: fetchFn as never,
    });
    expect(res.accessToken).toBe('a');
    expect(res.refreshToken).toBe('r');
    expect(res.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('throws on non-200', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'bad' });
    await expect(exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x', fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });

  it('throws on shape mismatch', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wrong: 1 }) });
    await expect(exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x', fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });

  it('includes code_verifier in body when provided (PKCE)', async () => {
    let capturedBody: string | undefined;
    const fetchFn = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      capturedBody = init.body;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'a', expires_in: 3600 }) });
    });
    await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      codeVerifier: 'verifier-abc',
      fetchFn: fetchFn as never,
    });
    expect(capturedBody).toContain('code_verifier=verifier-abc');
  });

  it('returns refreshToken=null when token response omits refresh_token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ access_token: 'a', expires_in: 3600 }),
    });
    const res = await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    });
    expect(res.refreshToken).toBeNull();
  });
});

describe('@fleet/driver-app - isTokenExpired', () => {
  it('returns true when past expiresAt', () => {
    expect(isTokenExpired({ accessToken: 'a', expiresAt: 0 } as never, Date.now() / 1000)).toBe(true);
  });
  it('returns false when before expiresAt', () => {
    expect(isTokenExpired({ accessToken: 'a', expiresAt: Date.now() / 1000 + 600 } as never, Date.now() / 1000)).toBe(false);
  });

  it('uses globalThis.fetch when fetchFn is not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'a', expires_in: 3600 }),
    });
    globalThis.fetch = spy as never;
    try {
      const res = await exchangeAuthCode({
        tokenEndpoint: 'http://idp/token',
        code: 'C',
        clientId: 'cid',
        redirectUri: 'fleetdriver://cb',
      });
      expect(res.accessToken).toBe('a');
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('@fleet/driver-app - exchangeAuthCode mutation-hardening', () => {
  it('POSTs to tokenEndpoint with method=POST, Content-Type=application/x-www-form-urlencoded, grant_type=authorization_code', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: { method?: string; headers?: Record<string, string>; body?: string } | undefined;
    const fetchFn = vi.fn().mockImplementation((u: string, init: typeof capturedInit) => {
      capturedUrl = u;
      capturedInit = init;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'a', expires_in: 3600 }) });
    });
    await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'fleetdriver://cb',
      fetchFn: fetchFn as never,
    });
    expect(capturedUrl).toBe('http://idp/token');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(capturedInit?.body).toContain('grant_type=authorization_code');
    expect(capturedInit?.body).toContain('code=C');
    expect(capturedInit?.body).toContain('client_id=cid');
  });

  it('non-200 throws an Error whose message names the OIDC token exchange and HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    await expect(exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/OIDC token exchange HTTP 401 Unauthorized/);
  });

  it('shape-mismatch throws an Error whose message names the invalid response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wrong: true }) });
    await expect(exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/OIDC token response invalid/);
  });

  it('expiresAt is roughly now+expires_in seconds (kills * 1000 mutant)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'a', expires_in: 3600 }),
    });
    const r = await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    });
    const after = Math.floor(Date.now() / 1000);
    // Math.floor(Date.now() / 1000) + 3600 should sit between before+3600 and after+3600
    expect(r.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(r.expiresAt).toBeLessThanOrEqual(after + 3600);
    // Sanity bound: mutated `* 1000` produces a value >>> than now+expires_in
    expect(r.expiresAt).toBeLessThan(before * 1000);
  });

  it('isTokenExpired uses <= (not <) at the boundary (kills <= -> < mutant)', () => {
    // At exact expiry boundary, token IS expired (<=, inclusive). Original returns true.
    expect(isTokenExpired({ accessToken: 'a', expiresAt: 1000 } as never, 1000)).toBe(true);
    // One second before: not expired.
    expect(isTokenExpired({ accessToken: 'a', expiresAt: 1000 } as never, 999)).toBe(false);
  });

  it('access_token must be min 1 char (kills min(1) -> max(1) mutant on access_token)', async () => {
    // Mutant changes z.string().min(1) to z.string().max(1). Original rejects ''.
    // Mutated rejects any string > 1 char (incl. our test token 'a' is OK — need >=2 char).
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'longertok', expires_in: 3600 }),
    });
    const r = await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    });
    expect(r.accessToken).toBe('longertok'); // mutated max(1) would reject, throwing
  });

  it('refresh_token (when present) must be min 1 char', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'a', refresh_token: 'refreshtok', expires_in: 3600 }),
    });
    const r = await exchangeAuthCode({
      tokenEndpoint: 'http://idp/token', code: 'C', clientId: 'cid', redirectUri: 'x',
      fetchFn: fetchFn as never,
    });
    expect(r.refreshToken).toBe('refreshtok');
  });
});
