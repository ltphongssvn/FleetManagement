// apps/ops-web/src/features/admin/reference-admin-client.ts
// Browser-side client for the reference master-data CRUD admin page. One
// instance per entity family (customers / cargo-types / vehicles /
// warehouses); it calls the /api/reference/* BFF routes, which attach the
// httpOnly session token server-side. fetch is injectable for tests.
//
// T5b error handling + problem-details migration: on a non-ok response,
// surface the localized server-provided message from EITHER wire shape --
// the RFC 9457 envelope the api emits today (detail member, loose
// must-ignore consumption via parseProblemDetails) or the legacy Nest
// shape { statusCode, message, error } (compat). detail/message are used
// for DISPLAY only; machine branching stays on the code extension. When
// neither yields a message, fall back to status-class Vietnamese via
// vnApiErrorMessage -- the manufactured raw transport-string class is
// eliminated (it leaked to the T5b e2e after the api migrated shapes
// and this client still parsed only .message).
//
// T5c: list(role, scope) accepts an optional 'admin' scope so the
// reference admin page can fetch ALL active rows (including unpaired
// vehicles) instead of the dispatch-form's pair-filtered subset.
import { parseProblemDetails } from '@fleet/sync-protocol';
import { vnApiErrorMessage } from '../errors/present-problem';

export type FetchFn = typeof globalThis.fetch;
export interface ReferenceOption {
  readonly id: string;
  readonly label: string;
  readonly meta?: Record<string, string | null>;
}
export type ReferenceSegment = 'customers' | 'cargo-types' | 'vehicles' | 'warehouses';
function serverMessageFrom(body: unknown): string | null {
  const problem = parseProblemDetails(body);
  if (typeof problem?.detail === 'string' && problem.detail.length > 0) return problem.detail;
  const legacy = body as { message?: unknown } | null;
  if (legacy !== null && typeof legacy === 'object' && typeof legacy.message === 'string' && legacy.message.length > 0) {
    return legacy.message;
  }
  return null;
}
async function failWithBestMessage(res: Response): Promise<never> {
  const body: unknown = await res.clone().json().catch(() => undefined);
  const serverMsg = serverMessageFrom(body);
  throw new Error(serverMsg ?? vnApiErrorMessage(res.status, body));
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
    if (!res.ok) await failWithBestMessage(res);
    const data = (await res.json()) as { items?: ReferenceOption[] };
    return data.items ?? [];
  }
  async create(name: string, role?: string, phone?: string | null): Promise<ReferenceOption> {
    const body: { name: string; role?: string; phone?: string | null } = { name };
    if (role !== undefined) body.role = role;
    if (phone !== undefined) body.phone = phone;
    const res = await this.fetchFn(this.base(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await failWithBestMessage(res);
    return (await res.json()) as ReferenceOption;
  }
  async update(id: string, name: string, phone?: string | null): Promise<void> {
    const body: { name: string; phone?: string | null } = { name };
    if (phone !== undefined) body.phone = phone;
    const res = await this.fetchFn(this.base() + '/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await failWithBestMessage(res);
  }
  async remove(id: string): Promise<void> {
    const res = await this.fetchFn(this.base() + '/' + id, { method: 'DELETE' });
    if (!res.ok) await failWithBestMessage(res);
  }
}
