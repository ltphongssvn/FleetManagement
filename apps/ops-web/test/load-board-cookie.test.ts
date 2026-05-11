// apps/ops-web/test/load-board-cookie.test.ts
// RED: loadDispatchBoard reads token from fleet_session cookie (not FLEET_API_TOKEN env).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
}));
vi.mock('server-only', () => ({}));
describe('loadDispatchBoard with cookie session', () => {
  beforeEach(() => { cookieGet.mockReset(); vi.unstubAllGlobals(); vi.resetModules(); });
  it('uses fleet_session cookie value as bearer token', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'production');
    cookieGet.mockReturnValue({ value: 'cookie-jwt-xyz' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    const rows = await loadDispatchBoard();
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('http://api:3000/dispatch/board', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer cookie-jwt-xyz' }),
    }));
  });
  it('throws in production when no cookie present', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    vi.stubEnv('NODE_ENV', 'production');
    cookieGet.mockReturnValue(undefined);
    const { loadDispatchBoard } = await import('@/features/dispatch/load-board');
    await expect(loadDispatchBoard()).rejects.toThrow(/session/i);
  });
});
