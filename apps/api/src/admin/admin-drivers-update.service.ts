// apps/api/src/admin/admin-drivers-update.service.ts
// Mutation service for the admin drivers CRUD UI. Two operations:
//   - update: rename a driver (fullName) and optionally update phone
//   - softDelete: flip active=false; preserves operatorId + JWT linkage so
//     historical road_runs that reference this driver keep resolving.
// Tenancy is enforced at the WHERE level (companyId + driverId) so a forged
// id from another tenant cannot mutate anything in this company's scope.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { normalizeDisplayName } from '@fleet/domain';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { transportOrder, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
export interface UpdateDriverInput {
  readonly driverId: string;
  readonly companyId: string;
  readonly fullName: string;
  readonly phone?: string;
}
export interface SoftDeleteDriverInput {
  readonly driverId: string;
  readonly companyId: string;
}
@Injectable()
export class AdminDriversUpdateService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async update(input: UpdateDriverInput): Promise<void> {
    // Normalize on rename too, so a rename cannot reintroduce a case/spacing
    // variant of an existing name (mirrors the create path + the lower() index).
    const patch: { fullName: string; phone?: string } = {
      fullName: normalizeDisplayName(input.fullName),
    };
    if (input.phone !== undefined) patch.phone = input.phone;
    await this.db
      .update(driver)
      .set(patch)
      .where(and(eq(driver.companyId, input.companyId), eq(driver.driverId, input.driverId)));
  }
  async softDelete(input: SoftDeleteDriverInput): Promise<void> {
    // Defense-in-depth (2026-Q2): soft-deleting a driver is a cascade.
    // Three operations in one transaction:
    //   1. flip driver.active = false
    //   2. revoke any active driver_vehicle_assignment for this driver
    //   3. cancel any non-terminal transport_order linked through
    //      road_run.assigned_operator_id (state NOT IN completed|cancelled)
    // Without (3), an E2E test (or any caller) that soft-deletes a driver
    // leaves orphan transport_order rows in the dispatch board forever.
    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Look up operatorId via driver row so we can match road_run.assigned_operator_id.
      const [d] = await tx
        .select({ operatorId: driver.operatorId })
        .from(driver)
        .where(and(eq(driver.companyId, input.companyId), eq(driver.driverId, input.driverId)));
      await tx
        .update(driver)
        .set({ active: false })
        .where(and(eq(driver.companyId, input.companyId), eq(driver.driverId, input.driverId)));
      await tx
        .update(driverVehicleAssignment)
        .set({ revokedAt: now, revocationReason: 'driver_soft_deleted' })
        .where(
          and(
            eq(driverVehicleAssignment.companyId, input.companyId),
            eq(driverVehicleAssignment.driverId, input.driverId),
            isNull(driverVehicleAssignment.revokedAt),
          ),
        );
      if (d?.operatorId !== undefined && d.operatorId !== null) {
        const openOrderIds = await tx
          .select({ id: transportOrder.transportOrderId })
          .from(transportOrder)
          .innerJoin(
            roadRunTransportOrder,
            eq(roadRunTransportOrder.transportOrderId, transportOrder.transportOrderId),
          )
          .innerJoin(roadRun, eq(roadRun.roadRunId, roadRunTransportOrder.roadRunId))
          .where(
            and(
              eq(transportOrder.companyId, input.companyId),
              eq(roadRun.assignedOperatorId, d.operatorId),
              inArray(transportOrder.state, ['draft', 'assigned', 'in_transit']),
            ),
          );
        if (openOrderIds.length > 0) {
          const ids = openOrderIds.map((r) => r.id);
          await tx
            .update(transportOrder)
            .set({
              state: 'cancelled',
              cancelledAt: now,
              cancellationReason: 'driver_soft_deleted',
              updatedAt: now,
            })
            .where(
              and(
                eq(transportOrder.companyId, input.companyId),
                inArray(transportOrder.transportOrderId, ids),
              ),
            );
        }
      }
    });
  }
}
