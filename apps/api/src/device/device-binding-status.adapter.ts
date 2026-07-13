// apps/api/src/device/device-binding-status.adapter.ts
// Drizzle-backed DeviceBindingStatusPort: resolves an operator device binding
// status from device_registry (device-binding arc, P5 slice-2d). Returns null
// when no row exists (never enrolled). Parses the stored value through the
// SSOT DeviceBindingStatusSchema so a malformed column never reaches the guard.
import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import { DeviceBindingStatusSchema, type DeviceBindingStatus } from '@fleet/sync-protocol';
import type { DeviceBindingStatusPort } from './device-binding.guard.js';

@Injectable()
export class DeviceBindingStatusAdapter implements DeviceBindingStatusPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async statusForOperator(operatorId: string): Promise<DeviceBindingStatus | null> {
    const rows = await this.db
      .select({ bindingStatus: deviceRegistry.bindingStatus })
      .from(deviceRegistry)
      .where(eq(deviceRegistry.operatorId, operatorId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    const parsed = DeviceBindingStatusSchema.safeParse(row.bindingStatus);
    return parsed.success ? parsed.data : null;
  }
}
