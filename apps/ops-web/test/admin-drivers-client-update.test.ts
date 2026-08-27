// apps/ops-web/test/admin-drivers-client-update.test.ts
// RED: AdminDriversClient.update PATCHes /api/admin/drivers/:id with body;
// .remove DELETEs /api/admin/drivers/:id (soft delete on the server).
import { describe, it, expect, vi } from 'vitest';
import { AdminDriversClient } from '../src/features/admin/admin-drivers-client';
describe('AdminDriversClient.update', () => {
  it('PATCHes /api/admin/drivers/:id with body', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const client = new AdminDriversClient({ fetchFn: fetchFn as never });
    await client.update('d1', { fullName: 'NEW', phone: '+84999999999' });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/admin/drivers/d1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fullName: 'NEW', phone: '+84999999999' }),
      }),
    );
  });
  it('PATCHes with only fullName when phone omitted', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const client = new AdminDriversClient({ fetchFn: fetchFn as never });
    await client.update('d1', { fullName: 'NEW' });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/admin/drivers/d1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ fullName: 'NEW' }),
      }),
    );
  });
  it('throws on non-ok HTTP status', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' });
    const client = new AdminDriversClient({ fetchFn: fetchFn as never });
    await expect(client.update('d1', { fullName: 'x' })).rejects.toThrow(/400/);
  });
  it('uses globalThis.fetch when fetchFn is not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({});
      await client.update('d1', { fullName: 'x' });
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
describe('AdminDriversClient.remove', () => {
  it('DELETEs /api/admin/drivers/:id', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const client = new AdminDriversClient({ fetchFn: fetchFn as never });
    await client.remove('d1');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/admin/drivers/d1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });
  it('throws on non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    const client = new AdminDriversClient({ fetchFn: fetchFn as never });
    await expect(client.remove('missing')).rejects.toThrow(/404/);
  });
  it('uses globalThis.fetch when fetchFn is not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    globalThis.fetch = spy as never;
    try {
      const client = new AdminDriversClient({});
      await client.remove('d1');
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
