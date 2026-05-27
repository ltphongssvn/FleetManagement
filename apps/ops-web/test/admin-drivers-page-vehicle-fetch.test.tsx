// apps/ops-web/test/admin-drivers-page-vehicle-fetch.test.tsx
// T5d L2: /admin/drivers must fetch vehicles with ?scope=admin.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
const listMock = vi.fn(() => Promise.resolve([]));
vi.mock('@/features/admin/admin-drivers-client', () => ({
  AdminDriversClient: class {
    list = listMock;
    create = vi.fn(() => Promise.resolve());
    update = vi.fn(() => Promise.resolve());
    remove = vi.fn(() => Promise.resolve());
    assign = vi.fn(() => Promise.resolve());
    enrollDevice = vi.fn(() => Promise.resolve());
    revoke = vi.fn(() => Promise.resolve());
  },
}));
const fetchMock = vi.fn();
function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  fetchMock.mockClear();
  listMock.mockImplementation(() => Promise.resolve([]));
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    fetchMock(url, init);
    return Promise.resolve(jsonRes({ items: [] }));
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
import AdminDriversPage from '@/app/admin/drivers/page';
describe('AdminDriversPage vehicle fetch scope (T5d)', () => {
  it('fetches /api/reference/vehicles?scope=admin', async () => {
    render(<AdminDriversPage />);
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u === '/api/reference/vehicles?scope=admin')).toBe(true);
    });
  });
  it('does NOT fetch /api/reference/vehicles without scope (would be pair-filtered)', async () => {
    render(<AdminDriversPage />);
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls).not.toContain('/api/reference/vehicles');
    });
  });
});
