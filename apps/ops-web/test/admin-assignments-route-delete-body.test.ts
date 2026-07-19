// apps/ops-web/test/admin-assignments-route-delete-body.test.ts
// RED (T11 idle-timeout arc): /api/admin/driver-vehicle-assignments/[id]
// DELETE must ride the app-wide forwarder AND preserve its JSON body --
// revoke() sends {reason} for the audit trail. forwardWrite historically
// dropped DELETE bodies (hasBody = method !== DELETE), so riding the seam
// naively would silently lose the reason. Body presence must be decided by
// the actual payload, not the verb (bodyless DELETE on drivers stays legal).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

const TOKEN_EP = 'https://kc.example.com/realms/fleet/protocol/openid-connect/token';
const API = 'http://api.internal:3000';
const MINTED = 'minted.access.token';

interface Ctx { params: Promise<{ id: string }> }
type DeleteHandler = (req: NextRequest, ctx: Ctx) => Promise<NextResponse>;

function seedCookies(map: Record<string, string>): void {
  cookieGet.mockImplementation((name: string) =>
    map[name] === undefined ? undefined : { name, value: map[name] },
  );
}

function fetchStub(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === TOKEN_EP) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: MINTED, refresh_token: 'rot', expires_in: 300 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ assignmentId: 'a1', revokedAt: '2026-07-11T00:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function makeDeleteReq(payload: string): NextRequest {
  return new NextRequest(
    new URL('https://ops.example.com/api/admin/driver-vehicle-assignments/a1'), {
      method: 'DELETE',
      body: payload,
      headers: { 'content-type': 'application/json' },
    },
  );
}

const ctx: Ctx = { params: Promise.resolve({ id: 'a1' }) };

describe('/api/admin/driver-vehicle-assignments/[id] DELETE rides the seam with body', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubEnv('FLEET_API_URL', API);
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', TOKEN_EP);
    vi.stubEnv('OIDC_CLIENT_ID', 'ops-web');
  });

  it('forwards DELETE with the {reason} body intact under a live session', async () => {
    seedCookies({ fleet_session: 'live-token' });
    const fetchMock = fetchStub();
    vi.stubGlobal('fetch', fetchMock);
    const { DELETE } = (await import(
      '@/app/api/admin/driver-vehicle-assignments/[id]/route'
    )) as unknown as { DELETE: DeleteHandler };
    const payload = JSON.stringify({ reason: 'driver reassigned to new truck' });
    const res = await DELETE(makeDeleteReq(payload), ctx);
    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('/admin/driver-vehicle-assignments/a1'),
    );
    expect(call).toBeDefined();
    const init = (call as unknown[])[1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(init.body as string).toBe(payload);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer live-token');
  });

  it('MINTS on miss for DELETE and still preserves the body', async () => {
    seedCookies({ fleet_refresh: 'old-rt' });
    const fetchMock = fetchStub();
    vi.stubGlobal('fetch', fetchMock);
    const { DELETE } = (await import(
      '@/app/api/admin/driver-vehicle-assignments/[id]/route'
    )) as unknown as { DELETE: DeleteHandler };
    const payload = JSON.stringify({ reason: 'xe hong, thu hoi phan cong' });
    const res = await DELETE(makeDeleteReq(payload), ctx);
    expect(res.status).toBe(200);
    const backend = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('/admin/driver-vehicle-assignments/a1'),
    );
    expect(backend).toBeDefined();
    const init = (backend as unknown[])[1] as RequestInit;
    expect(init.body as string).toBe(payload);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ' + MINTED);
    expect(res.cookies.get('fleet_session')?.value).toBe(MINTED);
  });
});
