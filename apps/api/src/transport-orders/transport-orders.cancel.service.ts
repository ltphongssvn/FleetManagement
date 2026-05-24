// apps/api/src/transport-orders/transport-orders.cancel.service.ts
// T5 (2026): dispatcher cancels a transport order. State transition is
// enforced via @fleet/domain transportOrderFsm so the cancel rule lives in
// the domain layer, not the service. Persistence writes the four audit
// columns added by migration 20260523181135_transport_order_cancellation_audit.
//
// Cascade rule (revealed by the L0 outside-in spec): cancelling a
// transport_order also cancels every road_run that fulfills it. The
// dispatcher review view sources its 'state' field from road_run.state
// via listAssigned/findById; without the cascade the UI would lie.
//
// Heal-on-idempotent (revealed by the same L0 spec on a second pass):
// the cascade also runs on the idempotent return path. This protects
// against partial-cancel races: if a prior cancel committed the
// transport_order update but crashed before the road_run cascade, a
// retry from the dispatcher idempotently re-issues the cascade and
// restores consistency. The cascade UPDATE filters on rr.state <>
// 'cancelled' so already-cancelled rows are not rewritten.
//
// Idempotency contract: a second cancel with the SAME reason returns the
// existing record (idempotent=true); a second cancel with a DIFFERENT
// reason is a 409 conflict at the controller boundary, raised here as
// TransportOrderCannotBeCancelledError. The idempotent guard also
// rejects audit rows missing any of cancelledAt / cancelledBy /
// cancellationReason: by the DB-level check constraint
// transport_order_cancelled_audit_consistent that state cannot exist,
// so treating it as a 409 conflict surfaces the corruption without
// crashing and without dead non-null assertions in production code.
//
// Tenant scope: cross-tenant requests look identical to not-found
// (TransportOrderNotFoundError) so the API does not leak existence of
// other tenants' orders.
import { Inject, Injectable } from '@nestjs/common';
import { eq, and, inArray, ne } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { transportOrder, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import { canTransition } from '@fleet/domain';
import type { OperatorContext } from '../auth/operator-context.js';
import {
  TransportOrderNotFoundError,
  TransportOrderCannotBeCancelledError,
} from './transport-orders.errors.js';
import type { CancelOrderInput, CancelOrderResult } from './transport-orders.cancel.dto.js';
@Injectable()
export class TransportOrdersCancelService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async cancel(id: string, input: CancelOrderInput, op: OperatorContext): Promise<CancelOrderResult> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          transportOrderId: transportOrder.transportOrderId,
          companyId: transportOrder.companyId,
          state: transportOrder.state,
          cancelledAt: transportOrder.cancelledAt,
          cancelledBy: transportOrder.cancelledBy,
          cancellationReason: transportOrder.cancellationReason,
          cancellationNote: transportOrder.cancellationNote,
        })
        .from(transportOrder)
        .where(and(
          eq(transportOrder.transportOrderId, id),
          eq(transportOrder.companyId, op.companyId),
        ))
        .limit(1);
      if (existing === undefined) {
        throw new TransportOrderNotFoundError();
      }
      const currentState = existing.state;
      if (currentState === 'cancelled') {
        const auditCancelledAt = existing.cancelledAt;
        const auditCancelledBy = existing.cancelledBy;
        const auditReason = existing.cancellationReason;
        if (
          auditCancelledAt === null ||
          auditCancelledBy === null ||
          auditReason === null ||
          auditReason !== input.reason
        ) {
          throw new TransportOrderCannotBeCancelledError(currentState);
        }
        await this.cascadeCancelLinkedRoadRuns(tx, id, op);
        return {
          transportOrderId: existing.transportOrderId,
          state: 'cancelled',
          cancelledAt: auditCancelledAt.toISOString(),
          cancelledBy: auditCancelledBy,
          cancellationReason: auditReason,
          cancellationNote: existing.cancellationNote,
          idempotent: true,
        };
      }
      if (!canTransition(currentState, 'cancelled')) {
        throw new TransportOrderCannotBeCancelledError(currentState);
      }
      const now = new Date();
      const note = input.note ?? null;
      const [updated] = await tx
        .update(transportOrder)
        .set({
          state: 'cancelled',
          cancelledAt: now,
          cancelledBy: op.operatorId,
          cancellationReason: input.reason,
          cancellationNote: note,
          updatedAt: now,
        })
        .where(and(
          eq(transportOrder.transportOrderId, id),
          eq(transportOrder.companyId, op.companyId),
        ))
        .returning();
      if (updated === undefined) {
        throw new TransportOrderNotFoundError();
      }
      await this.cascadeCancelLinkedRoadRuns(tx, id, op);
      return {
        transportOrderId: updated.transportOrderId,
        state: 'cancelled',
        cancelledAt: now.toISOString(),
        cancelledBy: op.operatorId,
        cancellationReason: input.reason,
        cancellationNote: note,
        idempotent: false,
      };
    });
  }
  private async cascadeCancelLinkedRoadRuns(
    tx: Parameters<Parameters<FleetDb['transaction']>[0]>[0],
    transportOrderId: string,
    op: OperatorContext,
  ): Promise<void> {
    const linkedRuns = await tx
      .select({ roadRunId: roadRunTransportOrder.roadRunId })
      .from(roadRunTransportOrder)
      .where(and(
        eq(roadRunTransportOrder.transportOrderId, transportOrderId),
        eq(roadRunTransportOrder.companyId, op.companyId),
      ));
    const roadRunIds = linkedRuns.map((r) => r.roadRunId);
    if (roadRunIds.length === 0) return;
    await tx
      .update(roadRun)
      .set({ state: 'cancelled' })
      .where(and(
        inArray(roadRun.roadRunId, roadRunIds),
        eq(roadRun.companyId, op.companyId),
        ne(roadRun.state, 'cancelled'),
      ));
  }
}
