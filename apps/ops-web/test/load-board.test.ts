// apps/ops-web/test/load-board.test.ts
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

describe('loadDispatchBoard', () => {
  it('returns PILOT_DATA in non-production when FLEET_API_URL is unset', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    delete process.env['FLEET_API_URL'];
    delete process.env['FLEET_API_TOKEN'];
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    const rows = await loadDispatchBoard();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.state).toBe('planned');
  });

  it('throws in production when FLEET_API_URL is unset (no silent fallback)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env['FLEET_API_URL'];
    delete process.env['FLEET_API_TOKEN'];
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    await expect(loadDispatchBoard()).rejects.toThrow('FLEET_API_URL');
  });

  it('parses valid api response with zod and returns rows', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    const apiRow = {
      roadRunId: 'aaaaaaaa-1111-4111-8111-111111111111',
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: '2026-04-29T12:00:00.000Z',
      stopCount: 2,
      transportOrderRefs: ['TO-1'],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rows: [apiRow] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    const rows = await loadDispatchBoard();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roadRunId).toBe(apiRow.roadRunId);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/dispatch/board',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('returns PILOT_DATA in dev when api response shape is invalid', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ wrong: 'shape' }),
    }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    const rows = await loadDispatchBoard();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.roadRunId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('throws in production when api response shape is invalid', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ wrong: 'shape' }),
    }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    await expect(loadDispatchBoard()).rejects.toThrow(/shape invalid/);
  });

  it('throws in production when api returns non-2xx', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    await expect(loadDispatchBoard()).rejects.toThrow(/503/);
  });

  it('redirects to /login in production when fleet_session cookie is missing', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    cookieGet.mockReturnValueOnce(undefined as never);
    const redirectMock = vi.fn((url: string) => { throw new Error('NEXT_REDIRECT:' + url); });
    vi.doMock('next/navigation', () => ({ redirect: redirectMock }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    await expect(loadDispatchBoard()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
  it('redirects to /login in production when api returns 401 (expired/invalid JWT)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    cookieGet.mockReturnValueOnce({ value: 'expired-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));
    const redirectMock = vi.fn((url: string) => { throw new Error('NEXT_REDIRECT:' + url); });
    vi.doMock('next/navigation', () => ({ redirect: redirectMock }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    await expect(loadDispatchBoard()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
  it('returns PILOT_DATA in dev when api returns 401 (no redirect outside prod)', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env['FLEET_API_URL'] = 'http://api.test';
    process.env['FLEET_API_TOKEN'] = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));
    const { loadDispatchBoard } = await import('../src/features/dispatch/load-board.js');
    const rows = await loadDispatchBoard();
    expect(rows.length).toBeGreaterThan(0);
  });
});
