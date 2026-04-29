// apps/api/src/projections/projection-runner.service.ts
// Materializes dispatch_board_projection from sync_change_feed events using
// the pure applyDispatchBoardEvent policy from @fleet/main-worker.
//
// Frozen Stack PDF: "projection_status table keyed by (projection_name, scope)
// with watermark, lag_ms, last_rebuilt_at" + Day-One #7.
//
// Concurrency safety: SELECT...FOR UPDATE on projection_status row locks the
// scope so only one runner processes events for a given (projectionName, scope)
// at a time. Pilot deploys 1 API instance; this guards future multi-instance.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, gt, sql } from 'drizzle-orm';
import {
  applyDispatchBoardEvent,
  DISPATCH_BOARD_PROJECTION_NAME,
  type SyncFeedEvent,
  type RoadRunProjectionRow,
} from '@fleet/main-worker';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  syncChangeFeed,
  dispatchBoardProjection,
  projectionStatus,
} from '../database/schema/index.js';

const POLL_BATCH_SIZE = 200;

export interface RunnerResult {
  readonly scope: string;
  readonly polled: number;
  readonly applied: number;
  readonly noops: number;
  readonly deletes: number;
  readonly newWatermark: string;
}

@Injectable()
export class ProjectionRunnerService {
  private readonly logger = new Logger(ProjectionRunnerService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /**
   * Drain sync_change_feed for one scope (companyId). Caller passes the scope
   * because tenancy is per-company in pilot. Returns counters for telemetry.
   */
  async drainOnce(scope: string): Promise<RunnerResult> {
    return this.db.transaction(async (tx) => {
      // Concurrency safety: SELECT ... FOR UPDATE locks nothing if the row
      // does not yet exist. Insert-on-conflict-do-nothing first guarantees the
      // row exists, THEN FOR UPDATE actually serializes concurrent runners.
      await tx
        .insert(projectionStatus)
        .values({ projectionName: DISPATCH_BOARD_PROJECTION_NAME, scope, watermark: 0n, lagMs: 0 })
        .onConflictDoNothing();
      const statusRows = await tx.execute(sql`
        SELECT projection_name, scope, watermark, lag_ms
        FROM ${projectionStatus}
        WHERE projection_name = ${DISPATCH_BOARD_PROJECTION_NAME} AND scope = ${scope}
        FOR UPDATE
      `);
      const sRows = (statusRows as unknown as { rows?: { watermark: string | bigint }[] }).rows
        ?? (statusRows as unknown as { watermark: string | bigint }[]);
      const w = sRows[0]?.watermark;
      const watermark: bigint = typeof w === 'bigint' ? w : BigInt(w ?? '0');

      const events = await tx
        .select({
          serverSeq: syncChangeFeed.serverSeq,
          aggregateType: syncChangeFeed.aggregateType,
          aggregateId: syncChangeFeed.aggregateId,
          delta: syncChangeFeed.delta,
          createdAt: syncChangeFeed.createdAt,
        })
        .from(syncChangeFeed)
        .where(and(eq(syncChangeFeed.companyId, scope), gt(syncChangeFeed.serverSeq, watermark)))
        .orderBy(syncChangeFeed.serverSeq)
        .limit(POLL_BATCH_SIZE);

      let applied = 0;
      let noops = 0;
      let deletes = 0;
      let newWatermark = watermark;
      // PDF lag_ms: freshness of READ MODEL, i.e. age of the OLDEST event still
      // unprocessed when we start this batch. Using the newest event in the
      // batch would mask large backlogs (e.g. 1h-old first event reported as 1s).
      const oldestEventCreatedAt = events[0]?.createdAt ?? null;

      for (const ev of events) {
        const event: SyncFeedEvent = {
          serverSeq: ev.serverSeq,
          aggregateType: ev.aggregateType,
          aggregateId: ev.aggregateId,
          delta: ev.delta,
        };

        // Load current projection row (if any) for this aggregate.
        const currentRows = await tx
          .select()
          .from(dispatchBoardProjection)
          .where(and(
            eq(dispatchBoardProjection.roadRunId, ev.aggregateId),
            eq(dispatchBoardProjection.companyId, scope),
          ))
          .limit(1);
        const currentRow = currentRows[0];
        const current: RoadRunProjectionRow | null = currentRow
          ? {
              roadRunId: currentRow.roadRunId,
              state: currentRow.state,
              assignedOperatorId: currentRow.assignedOperatorId,
              assignedAssetId: currentRow.assignedAssetId,
              plannedStartAt: currentRow.plannedStartAt?.toISOString() ?? null,
              stopCount: currentRow.stopCount,
              transportOrderRefs: currentRow.transportOrderRefs,
              serverSeq: currentRow.serverSeq,
            }
          : null;

        let decision;
        try {
          decision = applyDispatchBoardEvent(event, current);
        } catch (err: unknown) {
          // Pure policy should not throw, but defend against future edits or
          // exotic delta payloads. A bad event must not poison the batch.
          this.logger.warn(
            `Projection policy threw on aggregateId=${ev.aggregateId} seq=${ev.serverSeq.toString()}; treating as noop. ${err instanceof Error ? err.message : String(err)}`,
          );
          noops++;
          if (event.serverSeq > newWatermark) newWatermark = event.serverSeq;
          continue;
        }

        if (decision.kind === 'noop') {
          noops++;
        } else if (decision.kind === 'delete') {
          await tx.delete(dispatchBoardProjection).where(and(
            eq(dispatchBoardProjection.roadRunId, decision.roadRunId),
            eq(dispatchBoardProjection.companyId, scope),
          ));
          deletes++;
        } else {
          // upsert
          const row = decision.row;
          await tx
            .insert(dispatchBoardProjection)
            .values({
              roadRunId: row.roadRunId,
              companyId: scope,
              // PILOT TENANCY: Day-One Pilot Plan = 5 trucks, 1 depot, 1 company.
              // The full PDF tenancy is (companyId, businessUnitId, depotId, legalEntityId);
              // a scale-out ADR will replace these fallbacks with a real tenancy resolver
              // that joins sync_change_feed -> transport_order to recover the full tuple.
              businessUnitId: scope,
              depotId: scope,
              legalEntityId: scope,
              state: row.state,
              assignedOperatorId: row.assignedOperatorId,
              assignedAssetId: row.assignedAssetId,
              plannedStartAt: row.plannedStartAt ? new Date(row.plannedStartAt) : null,
              stopCount: row.stopCount,
              transportOrderRefs: row.transportOrderRefs,
              serverSeq: row.serverSeq,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: dispatchBoardProjection.roadRunId,
              set: {
                state: row.state,
                assignedOperatorId: row.assignedOperatorId,
                assignedAssetId: row.assignedAssetId,
                plannedStartAt: row.plannedStartAt ? new Date(row.plannedStartAt) : null,
                stopCount: row.stopCount,
                transportOrderRefs: row.transportOrderRefs,
                serverSeq: row.serverSeq,
                updatedAt: new Date(),
              },
            });
          applied++;
        }

        if (event.serverSeq > newWatermark) newWatermark = event.serverSeq;
      }

      const lagMs = oldestEventCreatedAt ? Date.now() - oldestEventCreatedAt.getTime() : 0;
      await tx
        .update(projectionStatus)
        .set({ watermark: newWatermark, lagMs, lastAppliedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(projectionStatus.projectionName, DISPATCH_BOARD_PROJECTION_NAME),
          eq(projectionStatus.scope, scope),
        ));

      this.logger.debug(
        `[projection ${DISPATCH_BOARD_PROJECTION_NAME} scope=${scope}] polled=${String(events.length)} applied=${String(applied)} noops=${String(noops)} deletes=${String(deletes)} watermark=${newWatermark.toString()} lagMs=${String(lagMs)}`,
      );

      return {
        scope,
        polled: events.length,
        applied,
        noops,
        deletes,
        newWatermark: newWatermark.toString(),
      };
    });
  }
}
