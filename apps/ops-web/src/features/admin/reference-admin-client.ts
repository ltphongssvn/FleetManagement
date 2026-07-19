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
import {
  parseProblemDetails,
  ReferenceItemSchema,
  ReferenceListResponseSchema,
  type ReferenceItem,
  type ReferenceSegment,
} from '@fleet/sync-protocol';
import { vnApiErrorMessage } from '../errors/present-problem';
import { ApiProblemError } from '../errors/api-problem-error';

export type FetchFn = typeof globalThis.fetch;
// ReferenceOption now DERIVES from the @fleet/sync-protocol SSOT (one of
// four consolidated hand-written twins); re-exported for existing imports.
export type ReferenceOption = ReferenceItem;
// ReferenceSegment likewise DERIVES from the sync-protocol SSOT: each member
// IS the api URL path segment, so the vocabulary is a wire contract, not a
// local convenience union. Re-exported for existing importers.
export type { ReferenceSegment };
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
  // ApiProblemError adds machine members (status + Zod-parsed code) while
  // .message keeps the SAME display copy as before (detail > legacy message >
  // status-class Vietnamese): conflict-name extraction on .message is
  // untouched, and pages can now branch on isSessionExpired (401).
  const problem = parseProblemDetails(body);
  throw new ApiProblemError(res.status, problem?.code, serverMsg ?? vnApiErrorMessage(res.status, body));
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
    // Parse at the boundary (never cast): shape-invalid envelopes drop to
    // [] -- the page already renders an empty state; a corrupt payload must
    // not enter state as trusted rows (the t5b lesson).
    const parsed = ReferenceListResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.items : [];
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
    // A create response that fails the contract is an error, not data.
    return ReferenceItemSchema.parse(await res.json());
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
