// apps/ops-web/src/features/admin/reference-admin-client.ts
// Browser-side client for the reference master-data CRUD admin page. One
// instance per entity family (customers / cargo-types / vehicles /
// warehouses); it calls the /api/reference/* BFF routes, which attach the
// httpOnly session token server-side. fetch is injectable for tests.
//
// T5b error handling: when the API returns a non-ok response (409 in
// particular), surface the localized server-provided message from the
// JSON body (Nest ConflictException renders { statusCode, message, error }).
// Falls back to a generic 'METHOD path HTTP <status>' string when the
// body is empty or not JSON.
//
// T5c: list(role, scope) accepts an optional 'admin' scope so the
// reference admin page can fetch ALL active rows (including unpaired
// vehicles) instead of the dispatch-form's pair-filtered subset.
export type FetchFn = typeof globalThis.fetch;
export interface ReferenceOption {
  readonly id: string;
  readonly label: string;
}
export type ReferenceSegment = 'customers' | 'cargo-types' | 'vehicles' | 'warehouses';
async function extractServerMessage(res: Response): Promise<string | null> {
  try {
    const data = await res.clone().json() as { message?: unknown };
    if (typeof data.message === 'string' && data.message.length > 0) return data.message;
    return null;
  } catch {
    return null;
  }
}
async function failWithBestMessage(res: Response, fallback: string): Promise<never> {
  const serverMsg = await extractServerMessage(res);
  throw new Error(serverMsg ?? fallback);
}
export class ReferenceAdminClient {
  private readonly fetchFn: FetchFn;
  constructor(private readonly segment: ReferenceSegment, fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }
  private base(): string {
    return '/api/reference/' + this.segment;
  }
  async list(role?: string, scope?: 'admin'): Promise<readonly ReferenceOption[]> {
    const params: string[] = [];
    if (role !== undefined) params.push('role=' + role);
    if (scope !== undefined) params.push('scope=' + scope);
    const url = params.length === 0 ? this.base() : this.base() + '?' + params.join('&');
    const res = await this.fetchFn(url, { method: 'GET' });
    if (!res.ok) await failWithBestMessage(res, 'GET ' + this.base() + ' HTTP ' + String(res.status));
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
    if (!res.ok) await failWithBestMessage(res, 'POST ' + this.base() + ' HTTP ' + String(res.status));
    return (await res.json()) as ReferenceOption;
  }
  async update(id: string, name: string): Promise<void> {
    const res = await this.fetchFn(this.base() + '/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) await failWithBestMessage(res, 'PATCH ' + this.base() + '/:id HTTP ' + String(res.status));
  }
  async remove(id: string): Promise<void> {
    const res = await this.fetchFn(this.base() + '/' + id, { method: 'DELETE' });
    if (!res.ok) await failWithBestMessage(res, 'DELETE ' + this.base() + '/:id HTTP ' + String(res.status));
  }
}
