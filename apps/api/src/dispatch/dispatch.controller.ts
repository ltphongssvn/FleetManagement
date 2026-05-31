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
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  dispatchBoardProjection,
  roadRunTransportOrder,
  stop,
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
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
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
    const rows = await this.db
      .select()
      .from(dispatchBoardProjection)
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(dispatchBoardProjection.plannedStartAt)
      .limit(DISPATCH_BOARD_MAX_ROWS);
    const roadRunIds = rows.map((r) => r.roadRunId);
    // Per-stop enrichment: join the board's road runs to their stops via
    // road_run_transport_order, with warehouse names. Grouped by road run.
    const stopsByRoadRun = new Map<string, DispatchBoardStop[]>();
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
    }
    return {
      rows: rows.map((r) => ({
        roadRunId: r.roadRunId,
        state: r.state,
        assignedOperatorId: r.assignedOperatorId,
        assignedAssetId: r.assignedAssetId,
        plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
        stopCount: r.stopCount,
        transportOrderRefs: r.transportOrderRefs,
        stops: stopsByRoadRun.get(r.roadRunId) ?? [],
      })),
    };
  }
}
