// apps/api/src/dispatch/driver-delivery.service.ts
// Driver delivery lifecycle: accept (planned->dispatched), start
// (dispatched->started), complete (started->completed). Each transition
// is FSM-validated via transitionRoadRun, operator-ownership-scoped, and
// recorded through the shared tri-write/projection path (same as creation).
//
// 2026 completion gate (permanent business rule): a road_run may only reach
// 'completed' once the driver has captured (committed) a manifest photo for
// EVERY stop of EVERY transport_order in the run. Missing any photo => the
// completion transition is REJECTED, so road_run.state stays non-terminal and
// the driver/truck remain BUSY (hidden from the dispatch dropdowns by the
// read-side anti-join in ReferenceService). The guard is pure + deterministic:
// it counts COMMITTED manifests vs stop count for the run's orders and reads
// only already-persisted state (state-machine guard best practice).
import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, count, inArray } from 'drizzle-orm';
import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
import { transitionRoadRun, roadRunFsm, ROAD_RUN_STATES, type RoadRunState } from '@fleet/domain';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { roadRun, roadRunTransportOrder, stop } from '../database/schema/transport.js';
import { manifest } from '../database/schema/manifest.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import type { OperatorContext } from '../auth/operator-context.js';
type Tx = Parameters<Parameters<FleetDb['transaction']>[0]>[0];
export interface DeliveryTransitionResult {
  readonly roadRunId: string;
  readonly state: RoadRunState;
}
@Injectable()
export class DriverDeliveryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  accept(roadRunId: string, op: OperatorContext): Promise<DeliveryTransitionResult> {
    return this.transition(roadRunId, op, 'dispatched', 'road_run.dispatched');
  }
  start(roadRunId: string, op: OperatorContext): Promise<DeliveryTransitionResult> {
    return this.transition(roadRunId, op, 'started', 'road_run.started');
  }
  complete(roadRunId: string, op: OperatorContext): Promise<DeliveryTransitionResult> {
    return this.transition(roadRunId, op, 'completed', 'road_run.completed');
  }
  // Completion gate: count stops vs committed manifests across the run's
  // transport_orders. Photos missing (committed < stops) => reject. Pure read
  // of committed state; no I/O side effects, deterministic for given state.
  private async assertAllManifestsCommitted(
    tx: Tx,
    roadRunId: string,
    op: OperatorContext,
  ): Promise<void> {
    const orderRows = await tx
      .select({ id: roadRunTransportOrder.transportOrderId })
      .from(roadRunTransportOrder)
      .where(and(
        eq(roadRunTransportOrder.roadRunId, roadRunId),
        eq(roadRunTransportOrder.companyId, op.companyId),
      ));
    const orderIds = orderRows.map((r) => r.id);
    // A road_run with no linked orders has nothing to photograph; treat as
    // trivially complete (no stops to satisfy). This cannot arise from the
    // normal create path (every order has >=1 pickup + >=1 delivery stop) but
    // keeps the guard total.
    if (orderIds.length === 0) return;
    const stopCountRows = await tx
      .select({ n: count() })
      .from(stop)
      .where(and(
        eq(stop.companyId, op.companyId),
        inArray(stop.transportOrderId, orderIds),
      ));
    const committedCountRows = await tx
      .select({ n: count() })
      .from(manifest)
      .where(and(
        eq(manifest.companyId, op.companyId),
        inArray(manifest.transportOrderId, orderIds),
        eq(manifest.state, 'committed'),
      ));
    /* v8 ignore next 2 -- defensive: a SQL count() aggregate always returns exactly one row, so [0] is never undefined and the ?? 0 fallback is unreachable */
    const stopCount = stopCountRows[0]?.n ?? 0;
    const committed = committedCountRows[0]?.n ?? 0;
    if (committed < stopCount) {
      // Driver-facing message in Vietnamese (the app surfaces it verbatim);
      // bracketed technical suffix keeps log/ops correlation in English.
      // Structured 409 (forgiving-FSM arc): actionable Vietnamese counts kept;
      // the [road_run ...] debug bracket is GONE -- internals never ride detail
      // (the id already travels in the instance member). Machines get the code
      // + { committed, required } extensions.
      throw new ConflictException({
        message:
          'Chưa thể hoàn thành lệnh điều xe: mới có ' + String(committed) + '/' +
          String(stopCount) + ' phiếu cân được ghi nhận. Vui lòng chụp đủ ảnh tại các điểm lấy và giao hàng.',
        code: 'MANIFESTS_INCOMPLETE',
        extensions: { committed, required: stopCount },
      });
    }
  }
  private transition(
    roadRunId: string,
    op: OperatorContext,
    next: RoadRunState,
    eventType: string,
  ): Promise<DeliveryTransitionResult> {
    return this.db.transaction(async (tx) => {
      const found = await tx
        .select({
          roadRunId: roadRun.roadRunId,
          state: roadRun.state,
          companyId: roadRun.companyId,
          assignedOperatorId: roadRun.assignedOperatorId,
        })
        .from(roadRun)
        .where(and(
          eq(roadRun.roadRunId, roadRunId),
          eq(roadRun.companyId, op.companyId),
          eq(roadRun.assignedOperatorId, op.operatorId),
        ))
        .limit(1);
      const rr = found[0];
      if (rr === undefined) {
        throw new NotFoundException('road_run ' + roadRunId + ' not found or not owned by operator');
      }
      const current: RoadRunState = rr.state;
      const result = transitionRoadRun(current, next);
      if (!result.allowed) {
        // Structured 409 (forgiving-FSM arc): Vietnamese detail carries NO
        // internal state names or machine tokens (presenters shield humans;
        // this shields the wire itself). Machines key off the code extension;
        // the forgiving driver flow keys off currentState + allowedActions,
        // DERIVED from the domain FSM table (terminal states -> []).
        const allowedActions = ROAD_RUN_STATES.filter((target) => roadRunFsm.canTransition(current, target));
        throw new ConflictException({
          message: 'Không thể thực hiện thao tác: trạng thái chuyến đã thay đổi. Vui lòng tải lại.',
          code: 'INVALID_STATE_TRANSITION',
          extensions: { currentState: current, allowedActions },
        });
      }
      // 2026 completion gate: only allow -> completed when all stop photos
      // (manifests) are committed for the run's orders.
      if (next === 'completed') {
        await this.assertAllManifestsCommitted(tx, roadRunId, op);
      }
      const now = new Date();
      const patch: Record<string, unknown> = { state: next };
      if (next === 'started') patch['startedAt'] = now;
      if (next === 'completed') patch['completedAt'] = now;
      await tx.update(roadRun).set(patch).where(eq(roadRun.roadRunId, roadRunId));
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: 'road_run',
        aggregateId: roadRunId,
        delta: { state: next },
        eventType,
        auditPayload: { roadRunId, from: current, to: next },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: { aggregateType: 'road_run', eventType, roadRunId },
        op,
      });
      return { roadRunId, state: next };
    });
  }
}
