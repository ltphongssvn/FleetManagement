// apps/ops-web/src/features/admin/admin-devices-client.ts
// Browser client for the devices approval-queue BFF routes. Every non-ok
// response is raised through the ensureOk seam as ApiProblemError (status-leading
// message + Zod-parsed problem code) so the presenter maps friendly Vietnamese
// copy and the page can branch on UNAUTHORIZED for silent-refresh navigation.
// The BFF authenticates via the httpOnly fleet_session cookie, so this client
// carries no Authorization header; fetchFn is the injectable test seam.
//
// Axis 1 (trust boundary): the SUCCESS path is VALIDATED, not cast. An HTTP
// response is untrusted input and the paginated envelope already has an SSOT
// schema, so a drifted or malformed payload fails loudly here instead of
// reaching the table as undefined fields. Axis 2: the row/envelope shape is
// never redeclared -- types come from the shared contract via z.infer.
import {
  AdminDeviceListResponseSchema,
  type AdminDeviceListQuery,
  type AdminDeviceListResponse,
} from '@fleet/sync-protocol';
import { ApiProblemError, ensureOk } from '@/features/errors/api-problem-error';

export type FetchFn = typeof globalThis.fetch;

export interface AdminDevicesClientConfig {
  readonly fetchFn?: FetchFn;
}

export class AdminDevicesClient {
  constructor(private readonly config: AdminDevicesClientConfig) {}

  private fetchFn(): FetchFn {
    return this.config.fetchFn ?? globalThis.fetch;
  }

  async list(query: AdminDeviceListQuery): Promise<AdminDeviceListResponse> {
    const params = new URLSearchParams({
      status: query.status,
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    const res = await this.fetchFn()('/api/admin/devices?' + params.toString(), { method: 'GET' });
    await ensureOk(res, 'GET /admin/devices');
    const parsed = AdminDeviceListResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      // Server drift or a truncated payload: fail loudly at the boundary rather
      // than rendering a half-shaped row. Status 200 with an unusable body is
      // still a broken response, so it rides the same error type the UI knows.
      throw new ApiProblemError(res.status, undefined, 'Du lieu thiet bi khong hop le');
    }
    return parsed.data;
  }

  async activate(deviceId: string): Promise<void> {
    await this.patchBinding(deviceId, { action: 'activate' });
  }

  async revoke(deviceId: string, revokedReason: string): Promise<void> {
    await this.patchBinding(deviceId, { action: 'revoke', revokedReason });
  }

  private async patchBinding(
    deviceId: string,
    body: { action: 'activate' } | { action: 'revoke'; revokedReason: string },
  ): Promise<void> {
    const res = await this.fetchFn()('/api/admin/devices/' + deviceId + '/binding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await ensureOk(res, 'PATCH /admin/devices/:id/binding');
  }
}
