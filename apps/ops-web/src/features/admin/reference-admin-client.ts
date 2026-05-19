// apps/ops-web/src/features/admin/reference-admin-client.ts
// Browser-side client for the reference master-data CRUD admin page. One
// instance per entity family (customers / cargo-types / vehicles /
// warehouses); it calls the /api/reference/* BFF routes, which attach the
// httpOnly session token server-side. fetch is injectable for tests.
export type FetchFn = typeof globalThis.fetch;
export interface ReferenceOption {
  readonly id: string;
  readonly label: string;
}
export type ReferenceSegment = 'customers' | 'cargo-types' | 'vehicles' | 'warehouses';
export class ReferenceAdminClient {
  private readonly fetchFn: FetchFn;
  constructor(private readonly segment: ReferenceSegment, fetchFn?: FetchFn) {
    // A bare reference to globalThis.fetch loses its Window binding when
    // later invoked as this.fetchFn(...), throwing 'Illegal invocation'.
    // Bind it (or keep the injected mock, which needs no binding).
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }
  private base(): string {
    return '/api/reference/' + this.segment;
  }
  async list(role?: string): Promise<readonly ReferenceOption[]> {
    const url = role === undefined ? this.base() : this.base() + '?role=' + role;
    const res = await this.fetchFn(url, { method: 'GET' });
    if (!res.ok) throw new Error('GET ' + this.base() + ' HTTP ' + String(res.status));
    const data = (await res.json()) as { items?: ReferenceOption[] };
    return data.items ?? [];
  }
  async create(name: string, role?: string): Promise<ReferenceOption> {
    const body = role === undefined ? { name } : { name, role };
    const res = await this.fetchFn(this.base(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('POST ' + this.base() + ' HTTP ' + String(res.status));
    return (await res.json()) as ReferenceOption;
  }
  async update(id: string, name: string): Promise<void> {
    const res = await this.fetchFn(this.base() + '/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('PATCH ' + this.base() + '/:id HTTP ' + String(res.status));
  }
  async remove(id: string): Promise<void> {
    const res = await this.fetchFn(this.base() + '/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('DELETE ' + this.base() + '/:id HTTP ' + String(res.status));
  }
}
