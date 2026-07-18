// apps/ops-web/src/features/admin/admin-drivers-client.ts
// Browser-side client for the /admin/drivers admin surface.
//
// AXIS 1 (trust boundary): GET /admin/drivers is untrusted input, so list()
// validates with parseAdminDriverRows -- the SSOT validator that was written
// for exactly this call site but had no production caller, leaving the
// boundary open. A shape-invalid payload is an ERROR, not data: list() throws
// and DriversSection renders its handled error state, instead of a well-typed
// lie entering React state and surfacing as an undefined read inside a cell
// renderer far from the cause (the t5b failure mode).
//
// Everything downstream (driver-attention.machine, the columns, the presenter)
// is trusted and never re-validated -- that is the other half of the rule.
//
// Write responses stay hand-written result types: internal, unduplicated,
// and not re-consumed as contracts (the CancelOrderResult precedent).
import { parseAdminDriverRows, type AdminDriverRow as DriverRow } from '@fleet/sync-protocol';
export type FetchFn = typeof globalThis.fetch;
export interface AdminDriversClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
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
  async list(): Promise<readonly DriverRow[]> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/drivers', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('/admin/drivers HTTP ' + String(res.status));
    const rows = parseAdminDriverRows(await res.json());
    if (rows === null) {
      throw new Error('/admin/drivers: phản hồi không hợp lệ (schema)');
    }
    return rows;
  }
  async create(input: CreateDriverInput): Promise<CreateDriverResult> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/drivers', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('POST /admin/drivers HTTP ' + String(res.status));
    return (await res.json()) as CreateDriverResult;
  }
  async update(driverId: string, input: UpdateDriverInput): Promise<void> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    // Build body so an omitted phone is not serialised as JSON null/undefined;
    // the server schema accepts the absent key but rejects null.
    const body: { fullName: string; phone?: string } = { fullName: input.fullName };
    if (input.phone !== undefined) body.phone = input.phone;
    const res = await fetchFn('/api/admin/drivers/' + driverId, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('PATCH /admin/drivers/:id HTTP ' + String(res.status));
  }
  async resetPassword(driverId: string, newPassword: string): Promise<void> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    // Service-desk reset: POST {newPassword} only (no current password). The
    // API is JWT-guarded and audit-logs the actor->target reset; 204 on success.
    const res = await fetchFn('/api/admin/drivers/' + driverId + '/reset-password', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) throw new Error('POST /admin/drivers/:id/reset-password HTTP ' + String(res.status));
  }
  async remove(driverId: string): Promise<void> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/drivers/' + driverId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('DELETE /admin/drivers/:id HTTP ' + String(res.status));
  }
  async assign(input: { driverId: string; vehicleId: string }): Promise<AssignResult> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/driver-vehicle-assignments', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('POST /admin/driver-vehicle-assignments HTTP ' + String(res.status));
    return (await res.json()) as AssignResult;
  }
  async enrollDevice(input: { driverId: string; udid: string; platform: string }): Promise<{ deviceId: string }> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    // Was the outlier: it parsed a 4xx/5xx body as if it were a success
    // envelope and returned an undefined deviceId. Every sibling throws.
    if (!res.ok) throw new Error('POST /admin/devices HTTP ' + String(res.status));
    return (await res.json()) as { deviceId: string };
  }
  async revoke(assignmentId: string, reason: string): Promise<RevokeResult> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn('/api/admin/driver-vehicle-assignments/' + assignmentId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('DELETE /admin/driver-vehicle-assignments/:id HTTP ' + String(res.status));
    return (await res.json()) as RevokeResult;
  }
}
