// apps/api/src/dispatch/dispatch.controller.ts
// Read-only HTTP endpoint serving dispatch_board_projection rows for ops-web.
// Frozen Stack PDF Day-One #7: "RSC reads from dispatch_board_projection".
// JwtGuard + CurrentOperator pattern mirrors manifest.controller.ts and
// sync.controller.ts so scope is taken from JWT claims (defense against IDOR
// where a caller could pass another tenant's companyId via query string).
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { dispatchBoardProjection } from '../database/schema/index.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';

/** Pilot dispatch board cap. PDF Day-One: 5 trucks/depot, ~tens of runs/day. */
const DISPATCH_BOARD_MAX_ROWS = 500;

export interface DispatchBoardRow {
  readonly roadRunId: string;
  readonly state: string;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
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
    return {
      rows: rows.map((r) => ({
        roadRunId: r.roadRunId,
        state: r.state,
        assignedOperatorId: r.assignedOperatorId,
        assignedAssetId: r.assignedAssetId,
        plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
        stopCount: r.stopCount,
        transportOrderRefs: r.transportOrderRefs,
      })),
    };
  }
}
