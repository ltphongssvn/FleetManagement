// apps/api/src/admin/admin-assignment.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  driverVehicleAssignment,
  type DriverVehicleAssignment,
} from '../database/schema/driver-vehicle-assignment.js';

export interface AssignInput {
  readonly driverId: string;
  readonly vehicleId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}

export interface RevokeInput {
  readonly assignmentId: string;
  readonly reason: string;
}

@Injectable()
export class AdminAssignmentService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async assign(input: AssignInput): Promise<DriverVehicleAssignment> {
    const [row] = await this.db
      .insert(driverVehicleAssignment)
      .values({
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        companyId: input.companyId,
        businessUnitId: input.businessUnitId,
        depotId: input.depotId,
        legalEntityId: input.legalEntityId,
      })
      .returning();
    /* c8 ignore next -- .returning() after insert always yields a row */
    if (!row) throw new Error('Assignment failed');
    return row;
  }

  async revoke(input: RevokeInput): Promise<DriverVehicleAssignment> {
    const [row] = await this.db
      .update(driverVehicleAssignment)
      .set({ revokedAt: new Date(), revocationReason: input.reason })
      .where(and(
        eq(driverVehicleAssignment.assignmentId, input.assignmentId),
        isNull(driverVehicleAssignment.revokedAt),
      ))
      .returning();
    if (!row) throw new Error('Assignment not found or already revoked');
    return row;
  }
}
