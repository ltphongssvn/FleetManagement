import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
// apps/api/src/transport-orders/transport-orders.service.ts
// Pilot seed: creates transport_order + stops + optional road_run, plus 3
// append paths so the dispatch_board projection picks it up.
//
// Driver-vehicle pair guard: when a road_run is supplied with both
// assignedOperatorId AND assignedAssetId, the service requires an active
// (non-revoked) driver_vehicle_assignment row in the calling company that
// binds the driver (by operator_id → driver_id) to the vehicle. The deepest
// defense layer behind dropdown filtering, client validation, and the Zod
// gate in the server action — even a bypassed front-end cannot persist a
// road_run whose driver-vehicle pair is not officially assigned.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { eq, and, asc, isNull } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { transportOrder, stop, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import { vehicle, customer, warehouse, driver } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { CreateTransportOrderInput, CreateTransportOrderResponse, ListAssignedResponse, TripHistoryResponse } from './transport-orders.dto.js';
import { DriverVehicleAssignmentRequiredError } from './transport-orders.errors.js';
import { groupCompletedTripsByMonth } from '@fleet/domain';
@Injectable()
export class TransportOrdersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async create(input: CreateTransportOrderInput, op: OperatorContext): Promise<CreateTransportOrderResponse> {
    return this.db.transaction(async (tx) => {
      const tenancy = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };
      // Driver-vehicle pair guard. Only enforced when the road_run carries
      // both an operator and an asset — partial road_runs (one side only)
      // are blocked at the form/action layer; here we focus on integrity of
      // the assignment binding for fully-specified road_runs.
      if (input.roadRun?.assignedOperatorId !== undefined && input.roadRun?.assignedAssetId !== undefined) {
        const [pair] = await tx.select({ assignmentId: driverVehicleAssignment.assignmentId })
          .from(driverVehicleAssignment)
          .innerJoin(driver, eq(driverVehicleAssignment.driverId, driver.driverId))
          .where(and(
            eq(driverVehicleAssignment.companyId, op.companyId),
            eq(driver.companyId, op.companyId),
            eq(driver.operatorId, input.roadRun.assignedOperatorId),
            eq(driverVehicleAssignment.vehicleId, input.roadRun.assignedAssetId),
            isNull(driverVehicleAssignment.revokedAt),
          ))
          .limit(1);
        if (!pair) throw new DriverVehicleAssignmentRequiredError();
      }
      const [created] = await tx.insert(transportOrder).values({
        ...tenancy,
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      }).returning();
      if (!created) throw new Error('transport_order insert failed');
      const transportOrderId = created.transportOrderId;
      for (const s of input.stops) {
        await tx.insert(stop).values({
          ...tenancy,
          transportOrderId,
          sequence: s.sequence,
          stopType: s.stopType,
          ...(s.yardId !== undefined ? { yardId: s.yardId } : {}),
          ...(s.plannedAt !== undefined ? { plannedAt: new Date(s.plannedAt) } : {}),
        });
      }
      let roadRunId: string | null = null;
      if (input.roadRun) {
        const [rr] = await tx.insert(roadRun).values({
          ...tenancy,
          ...(input.roadRun.plannedStartAt !== undefined ? { plannedStartAt: new Date(input.roadRun.plannedStartAt) } : {}),
          ...(input.roadRun.assignedOperatorId !== undefined ? { assignedOperatorId: input.roadRun.assignedOperatorId } : {}),
          ...(input.roadRun.assignedAssetId !== undefined ? { assignedAssetId: input.roadRun.assignedAssetId } : {}),
        }).returning();
        if (!rr) throw new Error('road_run insert failed');
        roadRunId = rr.roadRunId;
        await tx.insert(roadRunTransportOrder).values({
          ...tenancy,
          roadRunId,
          transportOrderId,
          sequence: 1,
        });
      }
      if (roadRunId) {
        const serverSeq = await allocateServerSeq(tx);
        const refs = input.externalRef ? [input.externalRef] : [];
        await appendTriWrite(tx, {
          serverSeq,
          actionId: randomUUID(),
          aggregateType: 'road_run',
          aggregateId: roadRunId,
          delta: {
            state: 'planned',
            assignedOperatorId: input.roadRun?.assignedOperatorId ?? null,
            assignedAssetId: input.roadRun?.assignedAssetId ?? null,
            plannedStartAt: input.roadRun?.plannedStartAt ?? null,
            stopCount: input.stops.length,
            transportOrderRefs: refs,
          },
          eventType: 'road_run.created',
          auditPayload: { transportOrderId },
          operatorId: op.operatorId,
          queueName: OUTBOX_QUEUES.PROJECTIONS,
          outboxPayload: { aggregateType: 'road_run', eventType: 'road_run.created', roadRunId },
          op,
        });
      }
      return { transportOrderId, roadRunId };
    });
  }


  async listAssigned(op: OperatorContext): Promise<ListAssignedResponse> {
    // Main query: assigned road runs joined to their transport order, plus
    // LEFT joins to the assigned vehicle and the order customer. LEFT joins
    // because assignedAssetId and customerId are both nullable — a road run
    // may have no vehicle and an order may have no customer.
    const rows = await this.db
      .select({
        transportOrderId: transportOrder.transportOrderId,
        externalRef: transportOrder.externalRef,
        roadRunId: roadRun.roadRunId,
        state: roadRun.state,
        plannedStartAt: roadRun.plannedStartAt,
        startedAt: roadRun.startedAt,
        completedAt: roadRun.completedAt,
        plate: vehicle.plate,
        customerName: customer.name,
      })
      .from(roadRun)
      .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
      .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
      .leftJoin(vehicle, eq(vehicle.vehicleId, roadRun.assignedAssetId))
      .leftJoin(customer, eq(customer.customerId, transportOrder.customerId))
      .where(and(
        eq(roadRun.companyId, op.companyId),
        eq(roadRun.assignedOperatorId, op.operatorId),
      ))
      .orderBy(asc(roadRun.plannedStartAt));
    const transportOrderIds = rows.map((r) => r.transportOrderId);
    // Stop query: LEFT join warehouse on the stop yard so each stop carries
    // its warehouse name. yardId is nullable, hence LEFT join.
    const stopRows = transportOrderIds.length === 0
      ? []
      : await this.db
          .select({
            transportOrderId: stop.transportOrderId,
            sequence: stop.sequence,
            stopType: stop.stopType,
            plannedAt: stop.plannedAt,
            warehouseName: warehouse.name,
          })
          .from(stop)
          .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
          .where(and(
            eq(stop.companyId, op.companyId),
          ))
          .orderBy(asc(stop.sequence));
    interface StopRow {
      sequence: number;
      stopType: string;
      plannedAt: Date | null;
      warehouseName: string | null;
    }
    const stopsByOrder = new Map<string, StopRow[]>();
    for (const sr of stopRows) {
      if (!transportOrderIds.includes(sr.transportOrderId)) continue;
      const list = stopsByOrder.get(sr.transportOrderId) ?? [];
      list.push({
        sequence: sr.sequence,
        stopType: sr.stopType,
        plannedAt: sr.plannedAt,
        warehouseName: sr.warehouseName,
      });
      stopsByOrder.set(sr.transportOrderId, list);
    }
    // Pickup/delivery name derivation. The stop_type column is a free-form
    // varchar with no DB enum, so match defensively (case-insensitive):
    //   pickup   -> stop_type === \'pickup\'
    //   delivery -> stop_type === \'delivery\' or \'dropoff\' (both denote the drop)
    // Stops are already ordered by sequence; the first pickup and the last
    // delivery stop are used. Any unmatched stop yields null.
    const pickupNameOf = (stops: readonly StopRow[]): string | null => {
      const s = stops.find((x) => x.stopType.toLowerCase() === 'pickup');
      return s?.warehouseName ?? null;
    };
    const deliveryNameOf = (stops: readonly StopRow[]): string | null => {
      const drops = stops.filter((x) => {
        const t = x.stopType.toLowerCase();
        return t === 'delivery' || t === 'dropoff';
      });
      const last = drops[drops.length - 1];
      return last?.warehouseName ?? null;
    };
    return {
      rows: rows.map((r) => {
        const stops = stopsByOrder.get(r.transportOrderId) ?? [];
        return {
          transportOrderId: r.transportOrderId,
          externalRef: r.externalRef ?? null,
          orderRef: r.externalRef ?? null,
          roadRunId: r.roadRunId,
          state: r.state,
          plannedStartAt: r.plannedStartAt ? r.plannedStartAt.toISOString() : null,
          startedAt: r.startedAt ? r.startedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          plate: r.plate ?? null,
          customerName: r.customerName ?? null,
          pickupName: pickupNameOf(stops),
          deliveryName: deliveryNameOf(stops),
          stops: stops.map((s) => ({
            sequence: s.sequence,
            stopType: s.stopType,
            plannedAt: s.plannedAt ? s.plannedAt.toISOString() : null,
          })),
        };
      }),
    };
  }

  // Trip history: the operator's completed road runs grouped by VN-timezone
  // month. Reuses the listAssigned query (same tenancy + enrichment), then
  // delegates month bucketing to the shared @fleet/domain helper so the API
  // and the driver app agree on month boundaries.
  async tripHistory(op: OperatorContext): Promise<TripHistoryResponse> {
    const assigned = await this.listAssigned(op);
    const groups = groupCompletedTripsByMonth(
      assigned.rows,
      (r) => r.state,
      (r) => r.completedAt,
    );
    return {
      months: groups.map((g) => ({
        monthKey: g.monthKey,
        label: g.label,
        count: g.count,
        trips: g.trips,
      })),
    };
  }
}
