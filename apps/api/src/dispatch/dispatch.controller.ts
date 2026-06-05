// apps/api/src/dispatch/dispatch.controller.ts
// Read-only HTTP endpoint serving dispatch_board_projection rows for ops-web.
// Frozen Stack PDF Day-One #7: 'RSC reads from dispatch_board_projection'.
// JwtGuard + CurrentOperator pattern mirrors manifest.controller.ts and
// sync.controller.ts so scope is taken from JWT claims (defense against IDOR).
//
// T10 (2026): each board row is enriched with its per-stop status (warehouse
// name + arrived/departed timestamps) so the Lệnh điều xe table can show
// Điểm nhận hàng 1..4 / Kho giao hàng 1 columns. The projection stays a
// summary (no schema change); per-stop detail is joined at read time from
// road_run_transport_order -> stop -> warehouse, scoped by company_id.
//
// KH column (2026): each row is also enriched with its customer name so the
// Lệnh điều xe table can show Khách hàng in place of Trạng thái. Joined at
// read time road_run_transport_order -> transport_order -> customer, scoped by
// company_id (same summary-projection + read-time-join pattern as T10). The
// projection schema is unchanged: customer is reference data already owned by
// the same tenant, so a read-time join is correct and avoids a migration.
//
// KH phone (2026): permanent business rule — the board row also carries the
// customer's Số điện thoại so the Lệnh điều xe table can display it next to
// Khách hàng. customer.phone is selected on the SAME read-time customer join
// (no extra query, no schema change). EXPAND-only/nullable: phone is null when
// the customer has none, so old data and old code stay valid.
//
// Tài xế + Xe display (2026): permanent business rule — the board row carries
// the assigned driver's full name (driverName) and the assigned vehicle's
// plate (vehiclePlate), resolved SERVER-SIDE at read time. Previously ops-web
// resolved assignedOperatorId/assignedAssetId to labels via a client-side
// reference lookup built from the dispatch form's driver/vehicle dropdown
// lists. After the hide-busy-driver-vehicle rule (PR #36) filters a now-busy
// driver/vehicle OUT of those dropdown lists, the client lookup misses and the
// Tài xế/Xe cells render em-dash. The fix mirrors the export service's proven
// joins: LEFT JOIN driver ON (operator_id = assigned_operator_id, companyId)
// and LEFT JOIN vehicle ON (vehicle_id = assigned_asset_id, companyId), so the
// label is authoritative and independent of the pair-filtered dropdowns. The
// companyId guard on each join prevents cross-tenant leakage; a missing
// reference row yields null (ops-web renders em-dash). Projection schema is
// unchanged — driver/vehicle are reference data owned by the same tenant.
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  customer,
  dispatchBoardProjection,
  driver,
  roadRunTransportOrder,
  stop,
  transportOrder,
  vehicle,
  warehouse,
} from '../database/schema/index.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
/** Pilot dispatch board cap. PDF Day-One: 5 trucks/depot, ~tens of runs/day. */
const DISPATCH_BOARD_MAX_ROWS = 500;
export interface DispatchBoardStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly warehouseName: string | null;
  readonly arrivedAt: string | null;
  readonly departedAt: string | null;
}
export interface DispatchBoardRow {
  readonly roadRunId: string;
  readonly state: string;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly driverName: string | null;
  readonly vehiclePlate: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly stops: readonly DispatchBoardStop[];
}
@Controller('dispatch')
@UseGuards(JwtGuard)
export class DispatchController {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  @Get('board')
  async getBoard(
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ rows: readonly DispatchBoardRow[] }> {
    // Resolve driver/vehicle labels SERVER-SIDE via the same proven joins the
    // export service uses, so the board never depends on the pair-filtered
    // dispatch-form dropdown lists for label resolution. companyId guards each
    // join against cross-tenant leakage; a missing reference row yields null.
    const rows = await this.db
      .select({
        roadRunId: dispatchBoardProjection.roadRunId,
        state: dispatchBoardProjection.state,
        assignedOperatorId: dispatchBoardProjection.assignedOperatorId,
        assignedAssetId: dispatchBoardProjection.assignedAssetId,
        plannedStartAt: dispatchBoardProjection.plannedStartAt,
        stopCount: dispatchBoardProjection.stopCount,
        transportOrderRefs: dispatchBoardProjection.transportOrderRefs,
        driverName: driver.fullName,
        vehiclePlate: vehicle.plate,
      })
      .from(dispatchBoardProjection)
      .leftJoin(driver, and(
        eq(driver.operatorId, dispatchBoardProjection.assignedOperatorId),
        eq(driver.companyId, op.companyId),
      ))
      .leftJoin(vehicle, and(
        eq(vehicle.vehicleId, dispatchBoardProjection.assignedAssetId),
        eq(vehicle.companyId, op.companyId),
      ))
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(dispatchBoardProjection.plannedStartAt)
      .limit(DISPATCH_BOARD_MAX_ROWS);
    const roadRunIds = rows.map((r) => r.roadRunId);
    // Per-stop enrichment: join the board's road runs to their stops via
    // road_run_transport_order, with warehouse names. Grouped by road run.
    const stopsByRoadRun = new Map<string, DispatchBoardStop[]>();
    // Customer enrichment: the first customer name found per road run, joined
    // via road_run_transport_order -> transport_order -> customer.
    const customerByRoadRun = new Map<string, string>();
    // Customer phone enrichment: the first customer phone found per road run,
    // taken from the SAME customer join. Null when the customer has no phone.
    const customerPhoneByRoadRun = new Map<string, string | null>();
    if (roadRunIds.length > 0) {
      const stopRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          sequence: stop.sequence,
          stopType: stop.stopType,
          warehouseName: warehouse.name,
          arrivedAt: stop.arrivedAt,
          departedAt: stop.departedAt,
        })
        .from(roadRunTransportOrder)
        .innerJoin(stop, eq(stop.transportOrderId, roadRunTransportOrder.transportOrderId))
        .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(stop.sequence);
      for (const sr of stopRows) {
        const list = stopsByRoadRun.get(sr.roadRunId) ?? [];
        list.push({
          sequence: sr.sequence,
          stopType: sr.stopType,
          warehouseName: sr.warehouseName,
          arrivedAt: sr.arrivedAt ? sr.arrivedAt.toISOString() : null,
          departedAt: sr.departedAt ? sr.departedAt.toISOString() : null,
        });
        stopsByRoadRun.set(sr.roadRunId, list);
      }
      const customerRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          customerName: customer.name,
          customerPhone: customer.phone,
        })
        .from(roadRunTransportOrder)
        .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
        .innerJoin(customer, eq(customer.customerId, transportOrder.customerId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(roadRunTransportOrder.sequence);
      for (const cr of customerRows) {
        if (!customerByRoadRun.has(cr.roadRunId)) {
          customerByRoadRun.set(cr.roadRunId, cr.customerName);
          customerPhoneByRoadRun.set(cr.roadRunId, cr.customerPhone);
        }
      }
    }
    return {
      rows: rows.map((r) => ({
        roadRunId: r.roadRunId,
        state: r.state,
        assignedOperatorId: r.assignedOperatorId,
        assignedAssetId: r.assignedAssetId,
        driverName: r.driverName,
        vehiclePlate: r.vehiclePlate,
        plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
        stopCount: r.stopCount,
        transportOrderRefs: r.transportOrderRefs,
        customerName: customerByRoadRun.get(r.roadRunId) ?? null,
        customerPhone: customerPhoneByRoadRun.get(r.roadRunId) ?? null,
        stops: stopsByRoadRun.get(r.roadRunId) ?? [],
      })),
    };
  }
}
