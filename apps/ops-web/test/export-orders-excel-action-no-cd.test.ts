// apps/ops-web/test/export-orders-excel-action-no-cd.test.ts
//
// Branch coverage for export-orders-excel.action.ts lines 17-19:
//   parseFilename returns fallback 'lenh-dieu-xe.xlsx' when:
//     (a) content-disposition header is absent
//     (b) header is present but the filename=\"...\" regex doesn't match
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
import { cookies } from 'next/headers';
import { exportOrdersExcel } from '../src/features/dispatch/export-orders-excel.action.js';
describe('@fleet/ops-web - exportOrdersExcel parseFilename fallbacks', () => {
  beforeEach(() => {
    process.env['FLEET_API_URL'] = 'http://api.test';
    vi.restoreAllMocks();
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
    } as never);
  });
  it('falls back when content-disposition is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }) as never,
    );
    const result = await exportOrdersExcel();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.filename).toBe('lenh-dieu-xe.xlsx');
  });
  it('falls back when content-disposition has no filename match', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b]), {
        status: 200,
        headers: { 'content-disposition': 'inline' },
      }) as never,
    );
    const result = await exportOrdersExcel();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.filename).toBe('lenh-dieu-xe.xlsx');
  });
});
