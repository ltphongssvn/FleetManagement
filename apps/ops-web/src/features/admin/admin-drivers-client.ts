// apps/ops-web/src/features/admin/admin-drivers-client.ts
// Browser client for the admin BFF routes. Every non-ok response is raised
// through the ensureOk seam as ApiProblemError (status-leading message +
// Zod-parsed problem code), so the presenter maps friendly Vietnamese copy
// and the page can branch on UNAUTHORIZED for the silent-refresh navigation.
// The BFF authenticates via the httpOnly fleet_session cookie, so this client
// carries no Authorization header. The former apiUrl/bearerToken config was
// vestigial (never read by any method) and has been removed as dead code; the
// only remaining injectable seam is fetchFn, which tests use to stub responses.
//
// TRUST BOUNDARY. list() PARSES the response through parseAdminDriverRows, the
// sync-protocol SSOT parser written for this exact call site. It previously
// imported the row type and then CAST to it, which is a promise to the compiler
// and no statement at all about the bytes: an object instead of an array, a row
// missing fullName, or driverId as a number all flowed through silently and
// surfaced later as an undefined property access inside a presenter, far from
// the cause. All three are pinned as tests now.
//
// The parse is safeParse-based and returns null rather than throwing, so junk
// degrades to a handled load error instead of an unhandled rejection at a fetch
// boundary. The contract is looseObject, so a newer producer adding a member
// never breaks an older consumer.
//
// The remaining as-casts on create/assign/revoke are DELIBERATE and are not the
// same defect: CreateDriverResult, AssignResult and RevokeResult are internal,
// single-use, unduplicated shapes with no SSOT and no second declaration, which
// the two-axis rule keeps as plain TypeScript. Only DriverRow has a shared
// contract, and therefore only DriverRow has a parser to route through.
//
// enrollDevice is DROPPED (not refactored): origin/develop removed the manual
// device-UDID pre-enroll path at the root (PR #302, superseded by T7
// self-enroll), taking the /api/admin/devices BFF route with it. Porting the
// method onto the new seam would resurrect a call to an endpoint that no
// longer exists.
import { parseAdminDriverRows, type AdminDriverRow as DriverRow } from '@fleet/sync-protocol';
import { ensureOk } from '@/features/errors/api-problem-error';
export type FetchFn = typeof globalThis.fetch;
export interface AdminDriversClientConfig {
  readonly fetchFn?: FetchFn;
}
export interface AssignResult {
  readonly assignmentId: string;
}
export interface RevokeResult {
  readonly assignmentId: string;
  readonly revokedAt: string;
}
export interface CreateDriverInput {
  readonly fullName: string;
  readonly phone: string;
  readonly password: string;
}
export interface CreateDriverResult {
  readonly driverId: string;
  readonly operatorId: string;
}
export interface UpdateDriverInput {
  readonly fullName: string;
  readonly phone?: string;
}
export class AdminDriversClient {
  constructor(private readonly config: AdminDriversClientConfig) {}
  private fetchFn(): FetchFn {
    return this.config.fetchFn ?? globalThis.fetch;
  }
  async list(): Promise<readonly DriverRow[]> {
    const res = await this.fetchFn()('/api/admin/drivers', { method: 'GET' });
    await ensureOk(res, 'GET /admin/drivers');
    const rows = parseAdminDriverRows(await res.json());
    if (rows === null) {
      throw new Error('GET /admin/drivers returned a payload that is not a driver roster');
    }
    return rows;
  }
  async create(input: CreateDriverInput): Promise<CreateDriverResult> {
    const res = await this.fetchFn()('/api/admin/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await ensureOk(res, 'POST /admin/drivers');
    return (await res.json()) as CreateDriverResult;
  }
  async update(driverId: string, input: UpdateDriverInput): Promise<void> {
    // Build body so an omitted phone is not serialised as JSON null/undefined;
    // the server schema accepts the absent key but rejects null.
    const body: { fullName: string; phone?: string } = { fullName: input.fullName };
    if (input.phone !== undefined) body.phone = input.phone;
    const res = await this.fetchFn()('/api/admin/drivers/' + driverId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await ensureOk(res, 'PATCH /admin/drivers/:id');
  }
  async resetPassword(driverId: string, newPassword: string): Promise<void> {
    // Service-desk reset: POST {newPassword} only (no current password). The
    // API is JWT-guarded and audit-logs the actor->target reset; 204 on success.
    const res = await this.fetchFn()('/api/admin/drivers/' + driverId + '/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    await ensureOk(res, 'POST /admin/drivers/:id/reset-password');
  }
  async remove(driverId: string): Promise<void> {
    const res = await this.fetchFn()('/api/admin/drivers/' + driverId, { method: 'DELETE' });
    await ensureOk(res, 'DELETE /admin/drivers/:id');
  }
  async assign(input: { driverId: string; vehicleId: string }): Promise<AssignResult> {
    const res = await this.fetchFn()('/api/admin/driver-vehicle-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await ensureOk(res, 'POST /admin/driver-vehicle-assignments');
    return (await res.json()) as AssignResult;
  }
  async revoke(assignmentId: string, reason: string): Promise<RevokeResult> {
    const res = await this.fetchFn()('/api/admin/driver-vehicle-assignments/' + assignmentId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    await ensureOk(res, 'DELETE /admin/driver-vehicle-assignments/:id');
    return (await res.json()) as RevokeResult;
  }
}
