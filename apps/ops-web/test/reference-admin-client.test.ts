// apps/ops-web/test/reference-admin-client.test.ts
// Unit: ReferenceAdminClient wraps the /api/reference/* BFF routes for the
// master-data CRUD admin page. One generic client keyed by entity segment
// (customers / cargo-types / vehicles / warehouses); list/create/update/
// remove map to GET / POST / PATCH / DELETE. fetch is injected and mocked.
import { describe, it, expect, vi } from 'vitest';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
describe('ReferenceAdminClient', () => {
  it('list() GETs the entity collection and returns items', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ items: [{ id: 'c1', label: 'Acme' }] })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    const items = await client.list();
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/reference/customers',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(items).toEqual([{ id: 'c1', label: 'Acme' }]);
  });
  it('list() returns [] when the response has no items field', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({})));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    expect(await client.list()).toEqual([]);
  });
  it('list(role) appends ?role for warehouses', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ items: [] })));
    const client = new ReferenceAdminClient('warehouses', fetchFn);
    await client.list('delivery');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/reference/warehouses?role=delivery',
      expect.objectContaining({ method: 'GET' }),
    );
  });
  it('list() omits the query string when no role is given', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ items: [] })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await client.list();
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/reference/customers',
      expect.objectContaining({ method: 'GET' }),
    );
  });
  it('list() throws on a non-ok response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ error: 'x' }, 500)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.list()).rejects.toThrow();
  });
  it('create() POSTs the name and returns the new option', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ id: 'g1', label: 'Rice' })));
    const client = new ReferenceAdminClient('cargo-types', fetchFn);
    const created = await client.create('Rice');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(call[0]).toBe('/api/reference/cargo-types');
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Rice' });
    expect(created).toEqual({ id: 'g1', label: 'Rice' });
  });
  it('create() forwards the optional role for warehouses', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ id: 'w1', label: 'Bay' })));
    const client = new ReferenceAdminClient('warehouses', fetchFn);
    await client.create('Bay', 'delivery');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Bay', role: 'delivery' });
  });
  it('create() throws on a non-ok response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ error: 'x' }, 400)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('X')).rejects.toThrow();
  });
  it('update() PATCHes the id path with the new name', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({})));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await client.update('c1', 'Acme Corp');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(call[0]).toBe('/api/reference/customers/c1');
    expect(call[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Acme Corp' });
  });
  it('update() throws on a non-ok response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ error: 'x' }, 500)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.update('c1', 'X')).rejects.toThrow();
  });
  it('remove() DELETEs the id path', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({})));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    await client.remove('v1');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(call[0]).toBe('/api/reference/vehicles/v1');
    expect(call[1]).toMatchObject({ method: 'DELETE' });
  });
  it('remove() throws on a non-ok response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ error: 'x' }, 500)));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    await expect(client.remove('v1')).rejects.toThrow();
  });
  it('create() forwards the optional phone for customers (Số điện thoại)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ id: 'c1', label: 'Acme' })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await client.create('Acme', undefined, '0901234567');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Acme', phone: '0901234567' });
  });
  it('update() forwards the optional phone for customers', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({})));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await client.update('c1', 'Acme', '0902222222');
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Acme', phone: '0902222222' });
  });
});
