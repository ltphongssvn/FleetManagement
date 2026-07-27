// apps/ops-web/test/forward-api-url-fail-fast.test.ts
// RED (T20 twelve-factor audit, Factor III -- Config): the app-wide BFF
// forwarder is the LAST silent deploy-config default in ops-web. Every
// other consumer of FLEET_API_URL already fails fast in production
// (load-board.ts, load-board-page.ts, load-order-review.ts all throw);
// _forward.ts alone falls back to the Docker Compose hostname
// http://api:3000, which is unresolvable in the Railway deploy.
//
// Why silent defaulting is the bug, not a convenience: a missing
// FLEET_API_URL in production turns EVERY admin BFF call into a DNS
// failure surfaced to the dispatcher as a generic load error, with
// nothing in the logs naming the real cause. Factor III says config
// that varies between deploys is validated at ONE boundary and a
// missing value stops the process loudly instead of pretending a
// development topology holds in production.
//
// Contract pinned here (mirrors load-board-page.ts exactly):
//   1. NODE_ENV=production + FLEET_API_URL unset -> throw naming the var
//   2. non-production + unset -> keep the Compose default (dev ergonomics)
//   3. set -> always honoured, in either environment
//   4. the throw happens BEFORE any network call (backend untouched)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest, NextResponse } from 'next/server';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

const COMPOSE_DEFAULT = 'http://api:3000';
const EXPLICIT = 'http://api.internal:3000';

interface Forwarder {
  forwardGet: (path: string, req?: NextRequest) => Promise<NextResponse>;
}

async function importForwarder(): Promise<Forwarder> {
  return (await import('@/app/api/_forward')) as unknown as Forwarder;
}

function okFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('@fleet/ops-web - BFF forwarder fails fast on missing FLEET_API_URL', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    cookieGet.mockImplementation((name: string) =>
      name === 'fleet_session' ? { name, value: 'live-token' } : undefined,
    );
  });

  it('throws in production when FLEET_API_URL is unset, naming the variable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLEET_API_URL', '');
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { forwardGet } = await importForwarder();
    await expect(forwardGet('/admin/drivers')).rejects.toThrow(/FLEET_API_URL/);
  });

  it('never reaches the network when the production guard trips', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLEET_API_URL', '');
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { forwardGet } = await importForwarder();
    await expect(forwardGet('/admin/drivers')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the Compose default outside production (dev ergonomics)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FLEET_API_URL', '');
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { forwardGet } = await importForwarder();
    const res = await forwardGet('/admin/drivers');
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(COMPOSE_DEFAULT + '/admin/drivers');
  });

  it('honours an explicit FLEET_API_URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLEET_API_URL', EXPLICIT);
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { forwardGet } = await importForwarder();
    const res = await forwardGet('/admin/drivers');
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(EXPLICIT + '/admin/drivers');
  });
});
