// apps/ops-web/test/load-board-cookie.test.ts
// RED: loadDispatchBoard reads token from fleet_session cookie (not FLEET_API_TOKEN env).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
}));
vi.mock('server-only', () => ({}));
describe('loadDispatchBoard with cookie session', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('uses fleet_session cookie value as bearer token', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'production');
    cookieGet.mockReturnValue({ value: 'cookie-jwt-xyz' });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ rows: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    const rows = await loadDispatchBoard();
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/dispatch/board',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer cookie-jwt-xyz' }),
      }),
    );
  });
  it('redirects to /login in production when no cookie present', async () => {
    // Behavior change: previously threw on missing session, which surfaced
    // a generic SSR error page. Now redirects to /login so the user can
    // re-authenticate. next/navigation.redirect() works by throwing a
    // NEXT_REDIRECT sentinel that Next intercepts.
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'production');
    cookieGet.mockReturnValue(undefined);
    const redirectMock = vi.fn((url: string) => {
      throw new Error('NEXT_REDIRECT:' + url);
    });
    vi.doMock('next/navigation', () => ({ redirect: redirectMock }));
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    await expect(loadDispatchBoard()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns PILOT_DATA in dev when no cookie present (line 61)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'development');
    cookieGet.mockReturnValue(undefined);
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    const rows = await loadDispatchBoard();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.roadRunId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('returns PILOT_DATA in dev when api returns non-2xx (line 71)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'development');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 503, statusText: 'down' }))),
    );
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    const rows = await loadDispatchBoard();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.roadRunId).toBe('11111111-1111-4111-8111-111111111111');
  });
});
