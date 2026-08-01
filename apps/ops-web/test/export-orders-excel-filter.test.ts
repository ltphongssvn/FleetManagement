// apps/ops-web/test/export-orders-excel-filter.test.ts
// RED (T67): the Xuat Excel server action must forward the dispatcher ACTIVE
// board search term and status tab, not just the day range.
//
// Root cause this closes: exportOrdersExcel built only ?from=&to=. The board
// already tracked ?search= and ?group= in URL state, but the export dropped
// both, so a dispatcher who filtered the board and pressed Xuat Excel silently
// downloaded the WHOLE board. This is the last hop of the chain -- API and
// contract already carry the filter; if the action does not send it, the fix
// never reaches production.
//
// Validation happens against the SSOT ExportQuerySchema BEFORE the fetch, so a
// malformed filter fails fast client-side too, and the query string can never
// drift from what the API accepts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
import { cookies } from 'next/headers';
import { exportOrdersExcel } from '../src/features/dispatch/export-orders-excel.action.js';
const FLEET_API_URL = 'http://api.test';
const BASE = FLEET_API_URL + '/transport-orders-export.xlsx';
function okResponse(): Response {
  return new Response(new Uint8Array([0x50, 0x4b]), {
    status: 200,
    headers: {
      'content-disposition':
        'attachment; filename=' + String.fromCharCode(34) + 'f.xlsx' + String.fromCharCode(34),
    },
  });
}
describe('@fleet/ops-web - exportOrdersExcel forwards the board filter', () => {
  beforeEach(() => {
    process.env['FLEET_API_URL'] = FLEET_API_URL;
    vi.restoreAllMocks();
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'jwt' }),
    } as never);
  });
  it('appends the search term, url-encoded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse() as never);
    const result = await exportOrdersExcel({ search: 'TAN KY' });
    expect(result.status).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledWith(
      BASE + '?search=TAN+KY',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
  it('appends the status group', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse() as never);
    await exportOrdersExcel({ group: 'cancelled' });
    expect(fetchSpy).toHaveBeenCalledWith(
      BASE + '?group=cancelled',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
  it('appends range, search and group together in a stable order', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse() as never);
    await exportOrdersExcel({
      from: '2026-07-01', to: '2026-07-31', search: 'TRAU', group: 'active',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      BASE + '?from=2026-07-01&to=2026-07-31&search=TRAU&group=active',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
  it('preserves Vietnamese diacritics through url encoding', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse() as never);
    await exportOrdersExcel({ search: 'Kho giao hàng' });
    // Narrow with a real type guard rather than String(): fetch accepts
    // RequestInfo | URL, so a blind stringify could yield [object Object] and
    // make the round-trip assertion below silently vacuous.
    const [calledUrl] = vi.mocked(fetchSpy).mock.calls[0] ?? [];
    if (typeof calledUrl !== 'string') {
      throw new Error('fetch was not called with a string URL');
    }
    expect(calledUrl.startsWith(BASE + '?search=')).toBe(true);
    // Percent-encoded on the wire, decoded back to the exact dispatcher input:
    // proof the diacritics survive the round trip intact.
    expect(calledUrl).not.toContain('hàng');
    expect(new URL(calledUrl).searchParams.get('search')).toBe('Kho giao hàng');
  });
  it('sends no query string for an empty filter (daily-backup invariant)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse() as never);
    await exportOrdersExcel();
    expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ cache: 'no-store' }));
  });
  it('fails fast WITHOUT fetching on a half-specified range', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await exportOrdersExcel({ from: '2026-07-01' });
    expect(result.status).toBe('server_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('fails fast WITHOUT fetching on an empty search term', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await exportOrdersExcel({ search: '' });
    expect(result.status).toBe('server_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
