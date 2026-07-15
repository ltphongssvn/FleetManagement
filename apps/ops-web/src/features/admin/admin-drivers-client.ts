// apps/ops-web/src/features/admin/admin-drivers-client.ts
// Browser client for the admin BFF routes. Every non-ok response is raised
// through the ensureOk seam as ApiProblemError (status-leading message +
// Zod-parsed problem code), so the presenter maps friendly Vietnamese copy
// and the page can branch on UNAUTHORIZED for the silent-refresh navigation.
// The BFF authenticates via the httpOnly fleet_session cookie, so this client
// carries no Authorization header. The former apiUrl/bearerToken config was
// vestigial (never read by any method) and has been removed as dead code; the
// only remaining injectable seam is fetchFn, which tests use to stub responses.
import type { AdminDriverRow as DriverRow } from '@fleet/sync-protocol';
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
    return (await res.json()) as readonly DriverRow[];
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
  async enrollDevice(input: { driverId: string; udid: string; platform: string }): Promise<{ deviceId: string }> {
    const res = await this.fetchFn()('/api/admin/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await ensureOk(res, 'POST /admin/devices');
    return (await res.json()) as { deviceId: string };
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
