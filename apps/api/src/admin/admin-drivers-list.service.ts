// apps/api/src/admin/admin-drivers-list.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle, type Driver, type Vehicle } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { deviceRegistry, type DeviceRegistry } from '../database/schema/device.js';

export interface ListInput {
  readonly companyId: string;
}

export interface DriverListRow {
  readonly driverId: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly operatorId: string | null;
  readonly assignedVehicle: Vehicle | null;
  readonly assignmentId: string | null;
  readonly devices: readonly DeviceRegistry[];
}

@Injectable()
export class AdminDriversListService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async list(input: ListInput): Promise<readonly DriverListRow[]> {
    const drivers: Driver[] = await this.db
      .select()
      .from(driver)
      .where(and(eq(driver.companyId, input.companyId), eq(driver.active, true)));
    const result: DriverListRow[] = [];
    for (const d of drivers) {
      const [a] = await this.db
        .select()
        .from(driverVehicleAssignment)
        .where(
          and(
            eq(driverVehicleAssignment.driverId, d.driverId),
            eq(driverVehicleAssignment.companyId, input.companyId),
            isNull(driverVehicleAssignment.revokedAt),
          ),
        )
        .limit(1);
      let assignedVehicle: Vehicle | null = null;
      if (a) {
        const [v] = await this.db
          .select()
          .from(vehicle)
          .where(eq(vehicle.vehicleId, a.vehicleId))
          .limit(1);
        /* c8 ignore next -- v is FK-guaranteed: assignment.vehicle_id
           references vehicle.vehicle_id so a matching row always exists */
        assignedVehicle = v ?? null;
      }
      const devices: DeviceRegistry[] =
        d.operatorId !== null
          ? await this.db
              .select()
              .from(deviceRegistry)
              .where(eq(deviceRegistry.operatorId, d.operatorId))
          : [];
      result.push({
        driverId: d.driverId,
        fullName: d.fullName,
        phone: d.phone,
        operatorId: d.operatorId,
        assignedVehicle,
        assignmentId: a?.assignmentId ?? null,
        devices,
      });
    }
    return result;
  }
}
