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
});

describe('@fleet/driver-app - isTokenExpired', () => {
  it('returns true when past expiresAt', () => {
    expect(isTokenExpired({ accessToken: 'a', expiresAt: 0 } as never, Date.now() / 1000)).toBe(true);
  });
  it('returns false when before expiresAt', () => {
    expect(isTokenExpired({ accessToken: 'a', expiresAt: Date.now() / 1000 + 600 } as never, Date.now() / 1000)).toBe(false);
  });
});
