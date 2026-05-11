// apps/api/src/dispatch/driver-assignments.controller.ts
// GET /driver/assignments — enriched road runs assigned to the authenticated driver.
// Joins: roadRun -> roadRunTransportOrder -> transportOrder -> customer
//        roadRun -> vehicle (via assignedAssetId)
//        transportOrder -> stop (pickup/delivery) -> warehouse
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { roadRun, roadRunTransportOrder, transportOrder, stop } from '../database/schema/transport.js';
import { customer, vehicle, warehouse } from '../database/schema/reference.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';

const DRIVER_ASSIGNMENTS_MAX_ROWS = 200;

export interface DriverAssignmentRow {
  readonly roadRunId: string;
  readonly state: string;
  readonly plannedStartAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly plate: string | null;
  readonly orderRef: string | null;
  readonly customerName: string | null;
  readonly pickupName: string | null;
  readonly deliveryName: string | null;
}

@Controller('driver')
@UseGuards(JwtGuard)
export class DriverAssignmentsController {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  @Get('assignments')
  async getAssignments(
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ rows: readonly DriverAssignmentRow[] }> {
    const pickup = sql`(SELECT w.name FROM ${stop} s JOIN ${warehouse} w ON w.warehouse_id = s.yard_id WHERE s.transport_order_id = ${transportOrder.transportOrderId} AND s.stop_type = 'pickup' ORDER BY s.sequence ASC LIMIT 1)`.as('pickupName');
    const delivery = sql`(SELECT w.name FROM ${stop} s JOIN ${warehouse} w ON w.warehouse_id = s.yard_id WHERE s.transport_order_id = ${transportOrder.transportOrderId} AND s.stop_type = 'delivery' ORDER BY s.sequence DESC LIMIT 1)`.as('deliveryName');

    const rows = await this.db
      .select({
        roadRunId: roadRun.roadRunId,
        state: roadRun.state,
        plannedStartAt: roadRun.plannedStartAt,
        startedAt: roadRun.startedAt,
        completedAt: roadRun.completedAt,
        plate: vehicle.plate,
        orderRef: transportOrder.externalRef,
        customerName: customer.name,
        pickupName: pickup,
        deliveryName: delivery,
      })
      .from(roadRun)
      .leftJoin(vehicle, eq(vehicle.vehicleId, roadRun.assignedAssetId))
      .leftJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
      .leftJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
      .leftJoin(customer, eq(customer.customerId, transportOrder.customerId))
      .where(and(eq(roadRun.assignedOperatorId, op.operatorId), eq(roadRun.companyId, op.companyId)))
      .orderBy(roadRun.plannedStartAt)
      .limit(DRIVER_ASSIGNMENTS_MAX_ROWS);

    return {
      rows: rows.map((r) => ({
        roadRunId: r.roadRunId,
        state: r.state,
        plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        plate: (r.plate as string | null) ?? null,
        orderRef: (r.orderRef as string | null) ?? null,
        customerName: (r.customerName as string | null) ?? null,
        pickupName: (r.pickupName as string | null) ?? null,
        deliveryName: (r.deliveryName as string | null) ?? null,
      })),
    };
  }
}
