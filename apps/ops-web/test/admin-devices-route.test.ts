// apps/ops-web/test/admin-devices-route.test.ts
// RED (P7 slice-B): the /api/admin/devices BFF routes are thin delegations over
// the shared _forward helper (bearer injection + mint-on-miss + verbatim
// passthrough). GET must preserve the incoming query string so the paginated,
// status-filtered API endpoint receives ?status=&page=&pageSize=. PATCH
// :deviceId/binding forwards method + JSON body to /admin/devices/:id/binding.
// The routes define no shapes and re-validate nothing: validation happens once at
// the API (request) and once in the client on read (response).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

const API = 'http://api.internal:3000';

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<NextResponse>;

function seedCookies(map: Record<string, string>): void {
  cookieGet.mockImplementation((name: string) =>
    map[name] === undefined ? undefined : { name, value: map[name] },
  );
}

function backendFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } })),
  );
}

describe('/api/admin/devices BFF routes', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubEnv('FLEET_API_URL', API);
    seedCookies({ fleet_session: 'live-token' });
  });

  it('GET forwards to /admin/devices preserving the status/page/pageSize query string', async () => {
    const fetchMock = backendFetch(JSON.stringify({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 0, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = (await import('@/app/api/admin/devices/route')) as unknown as { GET: RouteHandler };
    const req = new NextRequest(new URL('https://ops.example.com/api/admin/devices?status=active&page=2&pageSize=5'));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/devices'));
    expect(call).toBeDefined();
    expect(String((call as unknown[])[0])).toBe(API + '/admin/devices?status=active&page=2&pageSize=5');
    const init = (call as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer live-token');
  });

  it('GET with no query string forwards a bare /admin/devices path', async () => {
    const fetchMock = backendFetch(JSON.stringify({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 0, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = (await import('@/app/api/admin/devices/route')) as unknown as { GET: RouteHandler };
    const req = new NextRequest(new URL('https://ops.example.com/api/admin/devices'));
    await GET(req);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/devices'));
    expect(String((call as unknown[])[0])).toBe(API + '/admin/devices');
  });

  it('PATCH :deviceId/binding forwards method + JSON body to the API binding path', async () => {
    const fetchMock = backendFetch(JSON.stringify({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { PATCH } = (await import('@/app/api/admin/devices/[deviceId]/binding/route')) as unknown as { PATCH: RouteHandler };
    const deviceId = '00000000-0000-0000-0000-0000000000d1';
    const payload = JSON.stringify({ action: 'revoke', revokedReason: 'stolen' });
    const req = new NextRequest(new URL('https://ops.example.com/api/admin/devices/' + deviceId + '/binding'), {
      method: 'PATCH',
      body: payload,
      headers: { 'content-type': 'application/json' },
    });
    const ctx = { params: Promise.resolve({ deviceId }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/devices/'));
    expect(String((call as unknown[])[0])).toBe(API + '/admin/devices/' + deviceId + '/binding');
    const init = (call as unknown[])[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(init.body as string).toBe(payload);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer live-token');
  });

  it('answers 401 problem+json when no cookie survives; backend untouched', async () => {
    seedCookies({});
    const fetchMock = backendFetch(JSON.stringify({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = (await import('@/app/api/admin/devices/route')) as unknown as { GET: RouteHandler };
    const res = await GET(new NextRequest(new URL('https://ops.example.com/api/admin/devices')));
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('UNAUTHORIZED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
