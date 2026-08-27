// apps/ops-web/test/admin-drivers-route-mint-on-miss.test.ts
// RED (T11 idle-timeout arc): the /api/admin/drivers BFF route must ride the
// session-refresh seam exactly like reference/copilot routes, instead of dying
// with a raw 401 once the hour access-token expires while the page sits idle
// (prod evidence: GET /api/admin/drivers -> 401 -> page renders Loi: load failed).
//
// Pinned contract (mirrors api/reference/_forward.ts):
//   1. live fleet_session        -> forward with that bearer; token endpoint NOT hit
//   2. expired session + refresh -> silent re-mint at the Keycloak token endpoint,
//      backend called with the MINTED token, rotated cookie pair rides the response
//   3. no session, no refresh    -> 401 problem+json (code UNAUTHORIZED), backend untouched
//   4. refresh exchange fails    -> 401 problem+json, backend untouched
//   5. POST preserves method + JSON body through the mint path
// Cookie READS go through next/headers (seam contract); cookie WRITES land on the
// returned NextResponse (vercel/next.js#47126 lesson).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

const TOKEN_EP = 'https://kc.example.com/realms/fleet/protocol/openid-connect/token';
const API = 'http://api.internal:3000';
const MINTED = 'minted.access.token';
const ROTATED = 'rotated-refresh-token';

type RouteHandler = (req?: NextRequest) => Promise<NextResponse>;

async function importRoute(): Promise<{ GET: RouteHandler; POST: RouteHandler }> {
  return (await import('@/app/api/admin/drivers/route')) as unknown as {
    GET: RouteHandler;
    POST: RouteHandler;
  };
}

function seedCookies(map: Record<string, string>): void {
  cookieGet.mockImplementation((name: string) =>
    map[name] === undefined ? undefined : { name, value: map[name] },
  );
}

function routerFetch(opts: {
  tokenStatus?: number;
  backendStatus?: number;
  backendBody?: string;
}): ReturnType<typeof vi.fn> {
  const tokenStatus = opts.tokenStatus ?? 200;
  const backendStatus = opts.backendStatus ?? 200;
  const backendBody = opts.backendBody ?? JSON.stringify({ items: [] });
  return vi.fn((url: string) => {
    if (url === TOKEN_EP) {
      const ok = JSON.stringify({
        access_token: MINTED,
        refresh_token: ROTATED,
        expires_in: 300,
      });
      return Promise.resolve(
        new Response(tokenStatus === 200 ? ok : 'nope', {
          status: tokenStatus,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(backendBody, {
        status: backendStatus,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function makeGetReq(): NextRequest {
  return new NextRequest(new URL('https://ops.example.com/api/admin/drivers'));
}

describe('/api/admin/drivers BFF rides the session-refresh seam', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubEnv('FLEET_API_URL', API);
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', TOKEN_EP);
    vi.stubEnv('OIDC_CLIENT_ID', 'ops-web');
  });

  it('forwards with the live session bearer; token endpoint never hit', async () => {
    seedCookies({ fleet_session: 'live-token' });
    const fetchMock = routerFetch({ backendBody: JSON.stringify({ items: [{ id: 'd1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const tokenCalls = fetchMock.mock.calls.filter((c) => c[0] === TOKEN_EP);
    expect(tokenCalls).toHaveLength(0);
    const backendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/drivers'));
    expect(backendCall).toBeDefined();
    const init = (backendCall as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer live-token');
  });

  it('MINTS on miss: expired session + surviving fleet_refresh -> re-mint, rotated cookies ride the response', async () => {
    seedCookies({ fleet_refresh: 'old-rt' });
    const fetchMock = routerFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const tokenCall = fetchMock.mock.calls.find((c) => c[0] === TOKEN_EP);
    expect(tokenCall).toBeDefined();
    const tokenInit = (tokenCall as unknown[])[1] as RequestInit;
    const params = new URLSearchParams(tokenInit.body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('old-rt');
    const backendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/drivers'));
    expect(backendCall).toBeDefined();
    const init = (backendCall as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ' + MINTED);
    expect(res.cookies.get('fleet_session')?.value).toBe(MINTED);
    expect(res.cookies.get('fleet_session')?.httpOnly).toBe(true);
    expect(res.cookies.get('fleet_refresh')?.value).toBe(ROTATED);
  });

  it('answers 401 problem+json (code UNAUTHORIZED) when neither cookie survives; backend untouched', async () => {
    seedCookies({});
    const fetchMock = routerFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('UNAUTHORIZED');
    expect(body['status']).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 problem+json when the refresh exchange fails; backend untouched', async () => {
    seedCookies({ fleet_refresh: 'revoked-rt' });
    const fetchMock = routerFetch({ tokenStatus: 400 });
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('UNAUTHORIZED');
    const backendCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/admin/drivers'),
    );
    expect(backendCalls).toHaveLength(0);
  });

  it('POST create rides the mint path with method + JSON body preserved', async () => {
    seedCookies({ fleet_refresh: 'old-rt' });
    const fetchMock = routerFetch({
      backendStatus: 201,
      backendBody: JSON.stringify({ id: 'new-d' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await importRoute();
    const payload = JSON.stringify({ fullName: 'NGUYEN VAN A', phone: '0900000001' });
    const req = new NextRequest(new URL('https://ops.example.com/api/admin/drivers'), {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const backendCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/drivers'));
    expect(backendCall).toBeDefined();
    const init = (backendCall as unknown[])[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body as string).toBe(payload);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ' + MINTED);
    expect(res.cookies.get('fleet_session')?.value).toBe(MINTED);
  });
});
