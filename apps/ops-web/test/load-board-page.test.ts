// apps/ops-web/test/load-board-page.test.ts
// L2 RED-first unit test for the paginated dispatch-board loader. Mirrors
// load-board.test.ts (mock next/headers cookies + fetch + FLEET_API_URL,
// dynamic import per case). loadDispatchBoardPage(params) must call
// GET /dispatch/board/page with group/page/pageSize query params, forward the
// fleet_session JWT, parse DispatchBoardPageResponseSchema, and return the full
// envelope { data, page, pageSize, total, totalPages, hasMore }. Function does
// not exist yet => RED for the right reason.
const cookieGet = vi.fn(() => ({ value: 'test-token' }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: [
      {
        roadRunId: 'aaaaaaaa-1111-4111-8111-111111111111',
        state: 'planned',
        assignedOperatorId: null,
        assignedAssetId: null,
        plannedStartAt: '2026-06-01T08:00:00.000Z',
        stopCount: 1,
        transportOrderRefs: ['TO-1'],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasMore: false,
    ...overrides,
  };
}

describe('loadDispatchBoardPage', () => {
  it('calls GET /dispatch/board/page with group/page/pageSize and forwards the JWT', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(envelope()),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'finished', page: 2, pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    const call0 = fetchMock.mock.calls[0];
    if (call0 === undefined) throw new Error('expected fetch to have been called');
    const [url, opts] = call0;
    expect(url).toContain('http://api.test/dispatch/board/page');
    expect(url).toContain('group=finished');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=10');
    expect(opts).toMatchObject({
      cache: 'no-store',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('returns the full pagination envelope parsed by the SSOT schema', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            envelope({ page: 3, pageSize: 2, total: 5, totalPages: 3, hasMore: false, data: [] }),
          ),
      }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'active', page: 3, pageSize: 2 });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('defaults to group=active, page=1 when params omitted', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(envelope()),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await loadDispatchBoardPage({});
    const call0 = fetchMock.mock.calls[0];
    if (call0 === undefined) throw new Error('expected fetch to have been called');
    const [url] = call0;
    expect(url).toContain('group=active');
    expect(url).toContain('page=1');
  });

  it('throws in production when api response shape is invalid', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ wrong: 'shape' }),
      }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await expect(loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 })).rejects.toThrow(
      /shape invalid/,
    );
  });

  it('redirects to /login in production when api returns 401', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    cookieGet.mockReturnValueOnce({ value: 'expired-token' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }),
    );
    const redirectMock = vi.fn((u: string) => {
      throw new Error('NEXT_REDIRECT:' + u);
    });
    vi.doMock('next/navigation', () => ({ redirect: redirectMock }));
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await expect(loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    );
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('throws in production when FLEET_API_URL is unset', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env['FLEET_API_URL'];
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await expect(loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 })).rejects.toThrow(
      'FLEET_API_URL',
    );
  });

  it('returns an empty page in dev when FLEET_API_URL is unset', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    delete process.env['FLEET_API_URL'];
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'finished', page: 2, pageSize: 10 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('redirects to /login in production when the fleet_session cookie is missing', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    cookieGet.mockReturnValueOnce(undefined as never);
    const redirectMock = vi.fn((u: string) => {
      throw new Error('NEXT_REDIRECT:' + u);
    });
    vi.doMock('next/navigation', () => ({ redirect: redirectMock }));
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await expect(loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    );
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns an empty page in dev when the fleet_session cookie is missing', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    cookieGet.mockReturnValueOnce(undefined as never);
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 });
    expect(result.data).toEqual([]);
  });

  it('forwards the search param in the query string when provided', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(envelope()),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20, search: 'XTT.06' });
    const call0 = fetchMock.mock.calls[0];
    if (call0 === undefined) throw new Error('expected fetch to have been called');
    const [url] = call0;
    expect(url).toContain('search=XTT.06');
  });

  it('returns an empty page in dev when api returns 401 (no redirect outside prod)', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 });
    expect(result.data).toEqual([]);
  });

  it('throws in production when api returns a non-401 error (e.g. 503)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    await expect(loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 })).rejects.toThrow(
      /503/,
    );
  });

  it('returns an empty page in dev when api returns a non-401 error', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 });
    expect(result.data).toEqual([]);
  });

  it('returns an empty page in dev when the response shape is invalid', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ wrong: 'shape' }),
      }),
    );
    const { loadDispatchBoardPage } = await import('../src/features/dispatch/load-board-page.js');
    const result = await loadDispatchBoardPage({ group: 'active', page: 1, pageSize: 20 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });
});
