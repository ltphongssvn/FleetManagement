// apps/ops-web/src/features/admin/admin-drivers-client.ts
// Browser client for the admin BFF routes. Every non-ok response is raised
// through the ensureOk seam as ApiProblemError (status-leading message +
// Zod-parsed problem code), so the presenter maps friendly Vietnamese copy
// and the page can branch on UNAUTHORIZED for the silent-refresh navigation.
// The BFF authenticates via the httpOnly fleet_session cookie, so this client
// carries no Authorization header. The only injectable seam is fetchFn.
//
// AXIS 1 (trust boundary): GET /admin/drivers is untrusted input, so list()
// validates the payload with parseAdminDriverRows -- the SSOT validator that
// was written for exactly this call site but had no production caller, so the
// boundary was documented-closed yet actually open. A shape-invalid payload is
// an ERROR, not data: list() throws (after ensureOk has cleared transport) and
// DriversSection renders its handled error state, instead of a well-typed lie
// entering React state and surfacing as an undefined read in a cell renderer
// far from the cause (the t5b failure mode). Everything downstream
// (driver-attention.machine, columns, presenter) is trusted, never re-parsed.
//
// enrollDevice is intentionally ABSENT: origin/develop removed the manual
// device-UDID pre-enroll path at the root (PR #302, superseded by T7
// self-enroll), taking the /api/admin/devices BFF route with it. The dispatcher
// only assigns a vehicle; device identity is never hand-minted.
//
// Write responses stay hand-written result types: internal, unduplicated, and
// not re-consumed as contracts (the CancelOrderResult precedent).
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
      throw new Error('/admin/drivers: phản hồi không hợp lệ (schema)');
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
