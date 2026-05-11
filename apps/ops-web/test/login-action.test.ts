// apps/ops-web/test/login-action.test.ts
// RED: login server action exchanges username/password for token via OIDC password grant
// and sets it as httpOnly cookie 'fleet_session'.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
}));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));
describe('login server action', () => {
  beforeEach(() => { cookieSet.mockClear(); redirect.mockClear(); vi.unstubAllGlobals(); });
  it('rejects empty credentials with field errors', async () => {
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData();
    fd.set('username', ''); fd.set('password', '');
    const result = await login(undefined, fd);
    expect(result).toEqual({ status: 'invalid', errors: { username: 'Required', password: 'Required' } });  // pragma: allowlist secret
    expect(cookieSet).not.toHaveBeenCalled();
  });
  it('exchanges credentials for token and sets httpOnly cookie then redirects', async () => {
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', 'http://mock-oauth2:8080/fleet/token');
    const fakeJwt = 'header.payload.sig';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ access_token: fakeJwt, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }))));
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData();
    fd.set('username', 'dispatcher'); fd.set('password', 'pw');
    await expect(login(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(cookieSet).toHaveBeenCalledWith('fleet_session', fakeJwt, expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', secure: false }));
    expect(redirect).toHaveBeenCalledWith('/');
  });
  it('returns auth_failed when OIDC rejects credentials', async () => {
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', 'http://mock-oauth2:8080/fleet/token');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 }))));
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData();
    fd.set('username', 'bad'); fd.set('password', 'bad');
    const r = await login(undefined, fd);
    expect(r).toEqual({ status: 'auth_failed', message: 'Invalid username or password' });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
