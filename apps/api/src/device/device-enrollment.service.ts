// apps/api/src/device/device-enrollment.service.ts
// Upserts device_registry by (operatorId, platform). Idempotent enrollment.
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry, type DeviceRegistry } from '../database/schema/device.js';

export interface EnrollDeviceInput {
  readonly operatorId: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly expoPushToken?: string;
}

@Injectable()
export class DeviceEnrollmentService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async enroll(input: EnrollDeviceInput): Promise<DeviceRegistry> {
    const [row] = await this.db
      .insert(deviceRegistry)
      .values({
        operatorId: input.operatorId,
        platform: input.platform,
        appVersion: input.appVersion,
        companyId: input.companyId,
        businessUnitId: input.businessUnitId,
        depotId: input.depotId,
        legalEntityId: input.legalEntityId,
        expoPushToken: input.expoPushToken,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [deviceRegistry.operatorId, deviceRegistry.platform],
        set: { appVersion: input.appVersion, lastSeenAt: new Date(), expoPushToken: input.expoPushToken },
      })
      .returning();
    /* c8 ignore next -- .returning() after an upsert always yields a row */
    if (!row) throw new Error('Device enrollment failed');
    return row;
  }
}
