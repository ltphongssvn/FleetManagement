// apps/ops-web/test/export-orders-excel-action.test.ts
//
// L2 RED for export-backup feature. The server action exportOrdersExcel
// reads the JWT from fleet_session cookie, calls
// GET /transport-orders-export.xlsx, and returns the binary as a base64
// string + suggested filename so the client component can trigger a
// browser download. Failure paths surface a structured error state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));
import { cookies } from 'next/headers';
import { exportOrdersExcel } from '../src/features/dispatch/export-orders-excel.action.js';
const FLEET_API_URL = 'http://api.test';
describe('@fleet/ops-web - exportOrdersExcel action', () => {
  beforeEach(() => {
    process.env['FLEET_API_URL'] = FLEET_API_URL;
    vi.restoreAllMocks();
  });
  it('returns base64 body + filename when the API returns 200', async () => {
    const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'session-jwt-123' }),
    } as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(xlsxBytes, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename=\"lenh-dieu-xe_t_2026-05-24_manual_deadbeef.xlsx\"',
      },
    }) as never);
    const result = await exportOrdersExcel();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.filename).toBe('lenh-dieu-xe_t_2026-05-24_manual_deadbeef.xlsx');
    expect(Buffer.from(result.bodyBase64, 'base64')).toEqual(Buffer.from(xlsxBytes));
    expect(fetchSpy).toHaveBeenCalledWith(
      FLEET_API_URL + '/transport-orders-export.xlsx',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-jwt-123' }),
        cache: 'no-store',
      }),
    );
  });
  it('returns auth_required when no session cookie', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as never);
    const result = await exportOrdersExcel();
    expect(result.status).toBe('auth_required');
  });
  it('returns server_error when FLEET_API_URL missing', async () => {
    delete process.env['FLEET_API_URL'];
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
    } as never);
    const result = await exportOrdersExcel();
    expect(result.status).toBe('server_error');
  });
  it('returns server_error when API returns non-2xx', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
    } as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }) as never);
    const result = await exportOrdersExcel();
    expect(result.status).toBe('server_error');
  });
});
