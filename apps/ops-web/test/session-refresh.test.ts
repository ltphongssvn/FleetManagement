// apps/ops-web/test/session-refresh.test.ts
// RED-first: silent-refresh seam (2026 BFF pattern: refresh token lives in an
// httpOnly cookie server-side; BFF mints a new access token when the session
// cookie has expired -- dispatchers are never bounced to /login mid-shift).
import { describe, expect, it, vi } from 'vitest';
import {
  refreshEnvFromProcess,
  refreshSession,
  SESSION_COOKIE,
  REFRESH_COOKIE,
  sessionCookieOptions,
  refreshCookieOptions,
} from '../src/features/auth/session-refresh';

const ENV = {
  tokenEndpoint: 'https://kc.example/realms/fleet/protocol/openid-connect/token',
  clientId: 'ops-web',
};

function tokenRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('refreshSession', () => {
  it('exchanges the refresh token and returns rotated tokens', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        tokenRes({ access_token: 'newA', refresh_token: 'newR', expires_in: 300 }),
      ),
    );
    const out = await refreshSession('oldR', ENV, fetchFn as never);
    expect(out).toEqual({ accessToken: 'newA', refreshToken: 'newR', expiresIn: 300 });
    const call = fetchFn.mock.calls[0] as unknown as [string, { body: string }];
    expect(call[0]).toBe(ENV.tokenEndpoint);
    const params = new URLSearchParams(call[1].body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('oldR');
    expect(params.get('client_id')).toBe('ops-web');
  });

  it('returns null on a non-ok exchange (expired/revoked refresh)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(tokenRes({ error: 'invalid_grant' }, 400)));
    expect(await refreshSession('deadR', ENV, fetchFn as never)).toBeNull();
  });

  it('returns null when the exchange rejects or the body is not a token response', async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await refreshSession('r', ENV, rejecting as never)).toBeNull();
    const garbage = vi.fn(() => Promise.resolve(tokenRes({ nope: true })));
    expect(await refreshSession('r', ENV, garbage as never)).toBeNull();
  });

  it('keeps the old refresh token and defaults expiry when the IdP omits them', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(tokenRes({ access_token: 'newA' })));
    const out = await refreshSession('keepR', ENV, fetchFn as never);
    expect(out).toEqual({ accessToken: 'newA', refreshToken: 'keepR', expiresIn: 300 });
  });

  it('reads the refresh env from process (both set) and null when incomplete', () => {
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', ENV.tokenEndpoint);
    vi.stubEnv('OIDC_CLIENT_ID', ENV.clientId);
    expect(refreshEnvFromProcess()).toEqual(ENV);
    vi.stubEnv('OIDC_CLIENT_ID', '');
    vi.unstubAllEnvs();
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', ENV.tokenEndpoint);
    delete process.env['OIDC_CLIENT_ID'];
    expect(refreshEnvFromProcess()).toBeNull();
    vi.unstubAllEnvs();
  });

  it('exports the cookie contract used by callback, refresh route, and forwarder', () => {
    expect(SESSION_COOKIE).toBe('fleet_session');
    expect(REFRESH_COOKIE).toBe('fleet_refresh');
    expect(sessionCookieOptions(300)).toEqual(
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 300 }),
    );
    expect(refreshCookieOptions().maxAge).toBeGreaterThanOrEqual(8 * 3600);
    expect(refreshCookieOptions().httpOnly).toBe(true);
  });
});
