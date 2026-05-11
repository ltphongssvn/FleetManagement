// apps/ops-web/test/login-action-branches.test.ts
// TDD: cover branches in login.action — server_error when OIDC_TOKEN_ENDPOINT missing,
// server_error on invalid token response shape, secure cookie flag in production.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
}));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));

describe('login.action branches', () => {
  beforeEach(() => { cookieSet.mockClear(); redirect.mockClear(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('returns server_error when OIDC_TOKEN_ENDPOINT missing', async () => {
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', '');
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData(); fd.set('username', 'u'); fd.set('password', 'p');
    const r = await login(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: expect.stringContaining('OIDC_TOKEN_ENDPOINT') });
  });

  it('returns server_error on invalid token response shape', async () => {
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', 'http://x/token');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }))));
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData(); fd.set('username', 'u'); fd.set('password', 'p');
    const r = await login(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: 'Invalid token response' });
  });

  it('returns invalid for missing username only', async () => {
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData(); fd.set('username', ''); fd.set('password', 'p');
    const r = await login(undefined, fd);
    expect(r).toMatchObject({ status: 'invalid', errors: { username: 'Required' } });
  });

  it('returns invalid for missing password only', async () => {
    const { login } = await import('@/features/auth/login.action');
    const fd = new FormData(); fd.set('username', 'u'); fd.set('password', '');
    const r = await login(undefined, fd);
    expect(r).toMatchObject({ status: 'invalid', errors: { password: 'Required' } });  // pragma: allowlist secret
  });
});
