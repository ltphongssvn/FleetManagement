// apps/api/src/admin/admin-device-enroll.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { deviceRegistry, type DeviceRegistry } from '../database/schema/device.js';

export interface AdminEnrollInput {
  readonly driverId: string;
  readonly udid: string;
  readonly platform: string;
  readonly companyId: string;
}

@Injectable()
export class AdminDeviceEnrollService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async enroll(input: AdminEnrollInput): Promise<DeviceRegistry> {
    const drivers = await this.db.select().from(driver)
      .where(and(eq(driver.driverId, input.driverId), eq(driver.companyId, input.companyId)))
      .limit(1);
    const d = drivers[0];
    if (!d) throw new Error('Driver not found');
    if (d.operatorId === null) throw new Error('Driver has no operatorId; cannot enroll device');
    const [row] = await this.db.insert(deviceRegistry).values({
      operatorId: d.operatorId,
      platform: input.platform,
      appVersion: '0.0.0',
      udid: input.udid,
      companyId: d.companyId,
      businessUnitId: d.businessUnitId,
      depotId: d.depotId,
      legalEntityId: d.legalEntityId,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: [deviceRegistry.operatorId, deviceRegistry.platform],
      set: { udid: input.udid, lastSeenAt: new Date() },
    }).returning();
    if (!row) throw new Error('Device enrollment failed');
    return row;
  }
}
