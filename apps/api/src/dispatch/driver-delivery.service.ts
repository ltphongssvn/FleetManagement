// apps/api/src/dispatch/driver-delivery.service.ts
// Driver delivery lifecycle: accept (planned->dispatched), start
// (dispatched->started), complete (started->completed). Each transition
// is FSM-validated via transitionRoadRun, operator-ownership-scoped, and
// recorded through the shared tri-write/projection path (same as creation).
import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
import { transitionRoadRun, type RoadRunState } from '@fleet/domain';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { roadRun } from '../database/schema/transport.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import type { OperatorContext } from '../auth/operator-context.js';

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
        throw new BadRequestException(
          'illegal road_run transition ' + current + ' -> ' + next + ' (' + result.reason + ')',
        );
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
