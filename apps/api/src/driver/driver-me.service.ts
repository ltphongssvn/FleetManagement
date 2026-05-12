// apps/api/src/driver/driver-me.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle, type Driver, type Vehicle } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';

export interface DriverMeInput { readonly operatorId: string; readonly companyId: string; }
export interface DriverMeResult { readonly driver: Driver; readonly assignedVehicle: Vehicle | null; }

@Injectable()
export class DriverMeService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async fetchMe(input: DriverMeInput): Promise<DriverMeResult> {
    const [d] = await this.db.select().from(driver)
      .where(and(eq(driver.operatorId, input.operatorId), eq(driver.companyId, input.companyId)))
      .limit(1);
    if (!d) throw new Error('Driver not found for operator');
    const [a] = await this.db.select().from(driverVehicleAssignment)
      .where(and(
        eq(driverVehicleAssignment.driverId, d.driverId),
        eq(driverVehicleAssignment.companyId, input.companyId),
        isNull(driverVehicleAssignment.revokedAt),
      ))
      .limit(1);
    if (!a) return { driver: d, assignedVehicle: null };
    const [v] = await this.db.select().from(vehicle)
      .where(eq(vehicle.vehicleId, a.vehicleId))
      .limit(1);
    return { driver: d, assignedVehicle: v ?? null };
  }
}
