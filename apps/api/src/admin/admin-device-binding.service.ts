// apps/api/src/admin/admin-device-binding.service.ts
// Admin binding lifecycle (device-binding arc; P7 slice-A evolves list). list is
// company-scoped, status-FILTERED and offset-PAGINATED, returning the SSOT
// AdminDeviceListResponse envelope (data + page meta + total + hasMore) which the
// service validates on the way OUT (2026 practice: the API validates its own
// response so server drift is caught at emit time, not by the client). Ordering is
// (enrolled_at, device_id) so offset pages are deterministic. setBinding performs
// the TOFU transitions -- activate flips to active, revoke records revoked +
// binding_revoked_at + reason (never deletes; the row is the audit trail).
// Company scoping guards cross-tenant access on every query (BOLA defense).
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  AdminDeviceListResponseSchema,
  AdminDeviceRowSchema,
  type AdminDeviceListQuery,
  type AdminDeviceListResponse,
  type AdminDeviceRow,
  type DeviceBindingPatchRequest,
} from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';

@Injectable()
export class AdminDeviceBindingService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async list(companyId: string, query: AdminDeviceListQuery): Promise<AdminDeviceListResponse> {
    const where = and(
      eq(deviceRegistry.companyId, companyId),
      eq(deviceRegistry.bindingStatus, query.status),
    );
    // total FIRST (never paginate without a total): a company+status-scoped count.
    const countRows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(deviceRegistry)
      .where(where);
    /* v8 ignore next -- count(*) always returns one row; ?? 0 guards an impossible empty result */
    const total = countRows[0]?.n ?? 0;
    const offset = (query.page - 1) * query.pageSize;
    // (enrolled_at, device_id) is a stable, unique ordering so an offset page can
    // never skip or duplicate a row between requests (device_id breaks ties).
    const rows = await this.db
      .select({
        deviceId: deviceRegistry.deviceId,
        operatorId: deviceRegistry.operatorId,
        platform: deviceRegistry.platform,
        bindingStatus: deviceRegistry.bindingStatus,
        attestationSecurityLevel: deviceRegistry.attestationSecurityLevel,
        attestationEnvironment: deviceRegistry.attestationEnvironment,
        attestationVerifiedAt: deviceRegistry.attestationVerifiedAt,
        bindingRevokedReason: deviceRegistry.bindingRevokedReason,
      })
      .from(deviceRegistry)
      .where(where)
      .orderBy(asc(deviceRegistry.enrolledAt), asc(deviceRegistry.deviceId))
      .limit(query.pageSize)
      .offset(offset);
    // PARSED per row, never cast. The columns are varchar with a Drizzle { enum }
    // config, which infers the literal union but -- per Drizzle's own docs --
    // "won't check runtime values": Postgres enforces only the length. So the
    // TYPE is now right at every read site (the three `as` casts here are gone),
    // while rows written before a vocabulary existed still need a real check.
    //
    // Parsing ROW BY ROW rather than leaning on the envelope parse below means a
    // malformed row names itself instead of collapsing the admin page into one
    // opaque 500.
    const data: AdminDeviceRow[] = rows.map((r) => AdminDeviceRowSchema.parse({
      deviceId: r.deviceId,
      operatorId: r.operatorId,
      platform: r.platform,
      bindingStatus: r.bindingStatus,
      attestationSecurityLevel: r.attestationSecurityLevel,
      attestationEnvironment: r.attestationEnvironment,
      attestationVerifiedAt: r.attestationVerifiedAt === null ? null : r.attestationVerifiedAt.toISOString(),
      bindingRevokedReason: r.bindingRevokedReason,
    }));
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    // Validate our OWN response: parse the envelope through the SSOT schema so a
    // server-side shape drift surfaces here as a 500 at emit time, not silently.
    return AdminDeviceListResponseSchema.parse({
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async setBinding(companyId: string, deviceId: string, req: DeviceBindingPatchRequest): Promise<void> {
    const existing = await this.db
      .select({ deviceId: deviceRegistry.deviceId })
      .from(deviceRegistry)
      .where(and(eq(deviceRegistry.deviceId, deviceId), eq(deviceRegistry.companyId, companyId)))
      .limit(1);
    if (existing[0] === undefined) {
      throw new NotFoundException('Device not found');
    }
    if (req.action === 'activate') {
      await this.db.update(deviceRegistry)
        .set({ bindingStatus: 'active', bindingRevokedAt: null, bindingRevokedReason: null })
        .where(eq(deviceRegistry.deviceId, deviceId));
      return;
    }
    await this.db.update(deviceRegistry)
      .set({ bindingStatus: 'revoked', bindingRevokedAt: new Date(), bindingRevokedReason: req.revokedReason ?? null })
      .where(eq(deviceRegistry.deviceId, deviceId));
  }
}
