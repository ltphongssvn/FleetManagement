// apps/ops-web/test/load-roster-split.test.ts
// outside-in strict TDD RED: the server-only RSC loader for the
// dispatched-vs-idle panel, GET /dispatch/roster-split.
//
// DELIBERATE DIVERGENCE FROM THE SIBLING LOADERS. load-board-page.ts THROWS in
// production when the API misbehaves, because without board rows there is no
// page worth rendering. This panel is ADDITIVE to the dispatcher primary work
// surface: if the roster split fails, killing the whole board would stop
// dispatchers creating orders over a glance widget. So this loader returns
// null and the page renders the board WITHOUT the panel - degrade, never
// take the page down.
//
// 401 is the exception: an expired session affects everything on the page, so
// it still redirects to /login in production, exactly like the siblings.
//
// ENV IS STUBBED VIA vi.stubEnv, NOT BY ASSIGNMENT. process.env.NODE_ENV is
// typed readonly under this tsconfig, so a direct assignment fails typecheck
// (TS2540) even though it would run. stubEnv is the supported seam and
// unstubAllEnvs restores every key automatically, so no manual save/restore
// bookkeeping can drift.
//
// THE DYNAMIC IMPORT CARRIES NO TYPE ANNOTATION, matching load-board-page.test.ts.
// consistent-type-imports has disallowTypeAnnotations: true by default, which
// forbids import() in ANY type position - including a hoisted
// type X = typeof import('...') alias, which is why that workaround also fails.
// TypeScript infers the module shape from await import(...) on its own, so the
// annotation was never needed and removing it eliminates the rule surface
// rather than working around it.
//
// The response is parsed against the SSOT DispatchRosterSplitSchema. There is
// no loader-local schema.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const redirectMock = vi.fn();
const cookieGet = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: (): Promise<{ get: typeof cookieGet }> => Promise.resolve({ get: cookieGet }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string): void => {
    redirectMock(url);
  },
}));

const VALID = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 1,
  dispatched: [],
  idle: [
    {
      driverId: '22222222-2222-4222-8222-222222222222',
      driverName: 'NGUYỄN VĂN MẪU',
      vehiclePlate: '51A-22222',
      reason: 'no_dispatch_today',
    },
  ],
};

const MODULE_PATH = '../src/features/dispatch/load-roster-split.js';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, statusText: 'ERR', json: () => Promise.resolve({}) } as Response;
}

beforeEach(() => {
  vi.resetModules();
  redirectMock.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: 'jwt-token' });
  vi.stubEnv('FLEET_API_URL', 'http://api.test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadRosterSplit', () => {
  it('returns the parsed split on a valid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(VALID)));
    const { loadRosterSplit } = await import(MODULE_PATH);
    const result = await loadRosterSplit();
    expect(result).not.toBeNull();
    expect(result?.totalDrivers).toBe(1);
    expect(result?.idle[0]?.driverName).toBe('NGUYỄN VĂN MẪU');
  });

  it('calls the roster-split endpoint with the session bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(VALID));
    vi.stubGlobal('fetch', fetchMock);
    const { loadRosterSplit } = await import(MODULE_PATH);
    await loadRosterSplit();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/dispatch/roster-split');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-token');
  });

  it('never caches the response (the board is live data)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(VALID));
    vi.stubGlobal('fetch', fetchMock);
    const { loadRosterSplit } = await import(MODULE_PATH);
    await loadRosterSplit();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe('no-store');
  });

  it('returns null instead of throwing when the API errors in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(500)));
    const { loadRosterSplit } = await import(MODULE_PATH);
    await expect(loadRosterSplit()).resolves.toBeNull();
  });

  it('returns null instead of throwing when the payload shape is invalid', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ garbage: true })));
    const { loadRosterSplit } = await import(MODULE_PATH);
    await expect(loadRosterSplit()).resolves.toBeNull();
  });

  it('returns null instead of throwing when the network call rejects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { loadRosterSplit } = await import(MODULE_PATH);
    await expect(loadRosterSplit()).resolves.toBeNull();
  });

  it('redirects to login on 401 in production (an expired session affects the whole page)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(401)));
    const { loadRosterSplit } = await import(MODULE_PATH);
    await loadRosterSplit();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns null when FLEET_API_URL is unset outside production', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { loadRosterSplit } = await import(MODULE_PATH);
    await expect(loadRosterSplit()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without fetching when there is no session cookie', async () => {
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { loadRosterSplit } = await import(MODULE_PATH);
    await expect(loadRosterSplit()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
