// apps/ops-web/test/set-manual-net-weight-action.test.ts
// L2 tests for the setManualNetWeight server action (T33 Slice D). Mirrors the
// cancelOrder action pattern: SSOT-validated input, fleet_session bearer
// forwarded as PATCH /upload/manual-net-weight to the API, board revalidated on
// success, discriminated-union result on every path (never throws for expected
// errors -- 2026 Next.js Server Action guidance: return errors, do not throw).
//
// The value rule (positive kg) derives from the shared @fleet/sync-protocol
// netWeightKgSchema SSOT so the ops-web boundary and the API/worker paths cannot
// drift on what a valid net weight is (schema-first Axis-2). manifestId is a
// guid at the trust boundary (Axis-1).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
const VALID_ID = '11111111-1111-1111-1111-111111111111';
type FetchCall = [string, { method: string; body: string; headers: Record<string, string> }];
function defined<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected defined result');
  return v;
}
describe('setManualNetWeight server action (T33)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    revalidatePath.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('forwards a PATCH with bearer + JSON body and revalidates the board on success', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt-abc' });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ manifestId: VALID_ID, status: 'manual' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('ok');
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as FetchCall[];
    const first = defined(calls[0]);
    expect(first[0]).toBe('http://api:3000/upload/manual-net-weight');
    expect(first[1].method).toBe('PATCH');
    expect(first[1].headers['Authorization']).toBe('Bearer jwt-abc');
    const body = JSON.parse(first[1].body) as Record<string, unknown>;
    expect(body).toEqual({ manifestId: VALID_ID, extractedNetWeightKg: 19730 });
  });

  it('returns invalid when manifestId is not a uuid (never calls the API)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: 'not-a-uuid', extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns invalid when the weight is zero or negative (SSOT positive rule)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const zero = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 0 }),
    );
    expect(zero.status).toBe('invalid');
    const neg = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: -5 }),
    );
    expect(neg.status).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns server_error when FLEET_API_URL is missing', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('server_error');
  });

  it('returns unauthorized when the session cookie is missing (never calls the API)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('unauthorized');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the API returns 409 (manifest not committed)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'not committed' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('conflict');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns api_error with immutable Vietnamese copy on a 5xx', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );
    const { setManualNetWeight } = await import('@/features/dispatch/set-manual-net-weight.action');
    const r = defined(
      await setManualNetWeight({ manifestId: VALID_ID, extractedNetWeightKg: 19730 }),
    );
    expect(r.status).toBe('api_error');
    if (r.status !== 'api_error') throw new Error('not api_error');
    expect(r.message).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
  });
});
