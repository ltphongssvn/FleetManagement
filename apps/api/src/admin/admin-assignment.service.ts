// apps/api/src/admin/admin-assignment.service.ts
// T5e: when admin pairs a driver with a vehicle, the driver MUST have a
// non-null operator_id. The dispatch ReferenceService.driverVehicleAssignments
// query filters isNotNull(driver.operatorId) (operator_id is the FK target
// for road_run.assigned_operator_id NOT NULL constraint). Without this
// backfill, drivers created via /admin/drivers (no operator_id) get paired
// successfully but are invisible to the dispatch CreateOrderForm Section 3
// dropdowns — exactly the regression observed in production.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictException } from '@nestjs/common';
import { isPgUniqueViolationOnConstraintInChain } from '../common/pg-errors.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  driverVehicleAssignment,
  type DriverVehicleAssignment,
} from '../database/schema/driver-vehicle-assignment.js';
import { driver } from '../database/schema/reference.js';
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
    // Backfill operator_id if missing. Conditional UPDATE: only flips
    // NULL → new UUID, never overwrites an existing operator_id.
    await this.db
      .update(driver)
      .set({ operatorId: randomUUID() })
      .where(and(eq(driver.driverId, input.driverId), isNull(driver.operatorId)));
    // The two partial-unique indexes (dva_one_active_per_driver_uq /
    // dva_one_active_per_vehicle_uq, both verified VALID in prod) PREVENT a
    // duplicate active pair at the DB level. Translate the 23505 they throw
    // into a localized 409 (house pattern, isPgUniqueViolationOnConstraintInChain
    // distinguishes WHICH index fired) instead of leaking a raw 500.
    try {
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
    } catch (e) {
      if (isPgUniqueViolationOnConstraintInChain(e, 'dva_one_active_per_driver_uq')) {
        throw new ConflictException({
          message: 'Tài xế này đã được phân công một xe khác. Vui lòng hủy phân công cũ trước.',
          code: 'DRIVER_ALREADY_ASSIGNED',
        });
      }
      if (isPgUniqueViolationOnConstraintInChain(e, 'dva_one_active_per_vehicle_uq')) {
        throw new ConflictException({
          message: 'Xe này đã được phân công cho một tài xế khác. Vui lòng hủy phân công cũ trước.',
          code: 'VEHICLE_ALREADY_ASSIGNED',
        });
      }
      throw e;
    }
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
