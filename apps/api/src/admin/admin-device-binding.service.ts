// apps/api/src/admin/admin-device-binding.service.ts
// Admin binding lifecycle (device-binding arc, P5 slice-2e). list is
// company-scoped; setBinding performs TOFU transitions -- activate flips to
// active, revoke records revoked + binding_revoked_at + reason (never deletes,
// the row is the audit trail). Company scoping guards cross-tenant access.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import type { AdminDeviceRow, DeviceBindingPatchRequest } from '@fleet/sync-protocol';
@Injectable()
export class AdminDeviceBindingService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async list(companyId: string): Promise<AdminDeviceRow[]> {
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
      .where(eq(deviceRegistry.companyId, companyId));
    return rows.map((r) => ({
      deviceId: r.deviceId,
      operatorId: r.operatorId,
      platform: r.platform,
      bindingStatus: r.bindingStatus as AdminDeviceRow['bindingStatus'],
      attestationSecurityLevel: r.attestationSecurityLevel as AdminDeviceRow['attestationSecurityLevel'],
      attestationEnvironment: r.attestationEnvironment as AdminDeviceRow['attestationEnvironment'],
      attestationVerifiedAt: r.attestationVerifiedAt === null ? null : r.attestationVerifiedAt.toISOString(),
      bindingRevokedReason: r.bindingRevokedReason,
    }));
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
