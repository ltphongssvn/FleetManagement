// apps/ops-web/test/login-action-auto-backup.test.ts
//
// L2 RED: after a successful OIDC password-grant login, the action must
// fire a fire-and-forget POST to /transport-orders-export/auto with
// trigger='login' so the daily backup ledger row is recorded. Failures
// of the auto-backup must NOT block the login (best-effort backup).
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((to: string) => { throw new Error('REDIRECT:' + to); }) }));
import { cookies } from 'next/headers';
import { login } from '../src/features/auth/login.action.js';
describe('@fleet/ops-web - login.action auto-backup wiring', () => {
  beforeEach(() => {
    process.env['OIDC_TOKEN_ENDPOINT'] = 'http://oidc.test/token';
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.restoreAllMocks();
    vi.mocked(cookies).mockResolvedValue({
      set: vi.fn(), get: vi.fn(), delete: vi.fn(),
    } as never);
  });
  it('on successful login: POSTs to /transport-orders-export/auto with trigger=login', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'jwt-abc', expires_in: 3600 }), { status: 200 }) as never;
      }
      if (url.includes('/transport-orders-export/auto')) {
        return new Response(JSON.stringify({ exportLogId: 'log-1' }), { status: 200 }) as never;
      }
      throw new Error('unexpected ' + url);
    });
    const fd = new FormData();
    fd.set('username', 'dispatcher');
    fd.set('password', 'pw');
    await expect(login(undefined, fd)).rejects.toThrow(/REDIRECT/);
    const autoCalls = fetchSpy.mock.calls.filter(
      (c) => String(c[0]).includes('/transport-orders-export/auto'),
    );
    expect(autoCalls.length).toBe(1);
    const init = autoCalls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ trigger: 'login' });
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
  });
  it('auto-backup failure does NOT block the login', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'jwt-abc' }), { status: 200 }) as never;
      }
      return new Response('boom', { status: 500 }) as never;
    });
    const fd = new FormData();
    fd.set('username', 'dispatcher');
    fd.set('password', 'pw');
    // Must still redirect (login succeeded) despite backup failure.
    await expect(login(undefined, fd)).rejects.toThrow(/REDIRECT/);
  });
});
