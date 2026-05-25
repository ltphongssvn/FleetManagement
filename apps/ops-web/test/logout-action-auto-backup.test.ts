// apps/ops-web/test/logout-action-auto-backup.test.ts
//
// L2: logout.action must fire the auto-backup with trigger='logout'
// BEFORE deleting the session cookie (the API call needs the JWT). Backup
// failures must NOT block the redirect to /login.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((to: string) => { throw new Error('REDIRECT:' + to); }) }));
import { cookies } from 'next/headers';
import { logout } from '../src/features/auth/logout.action.js';
describe('@fleet/ops-web - logout.action auto-backup wiring', () => {
  beforeEach(() => {
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.restoreAllMocks();
  });
  it('on logout: POSTs to /transport-orders-export/auto with trigger=logout using session token before cookie delete', async () => {
    const deleteMock = vi.fn();
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt-xyz' }),
      delete: deleteMock,
    } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }) as never,
    );
    await expect(logout()).rejects.toThrow(/REDIRECT/);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error('no fetch call');
    const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
    expect(url).toContain('/transport-orders-export/auto');
    const init: RequestInit | undefined = call[1];
    if (!init) throw new Error('no init');
    expect(JSON.parse(init.body as string)).toEqual({ trigger: 'logout' });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-xyz');
    expect(deleteMock).toHaveBeenCalledWith('fleet_session');
  });
  it('no session token: skips backup, still redirects', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
      delete: vi.fn(),
    } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }) as never);
    await expect(logout()).rejects.toThrow(/REDIRECT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('backup failure does NOT block the logout redirect', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
      delete: vi.fn(),
    } as never);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net down'));
    await expect(logout()).rejects.toThrow(/REDIRECT/);
  });
});
