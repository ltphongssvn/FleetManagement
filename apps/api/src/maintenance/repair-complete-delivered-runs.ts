// apps/api/src/maintenance/repair-complete-delivered-runs.ts
// Event-sourced completion reconciler (T16 arc, 2026-07-12): find non-
// terminal road_runs whose linked transport_orders are ALL fully photo-
// committed -- committed manifests >= stop count, the SAME predicate the
// live completion gate DriverDeliveryService.assertAllManifestsCommitted
// enforces -- and drive each started->completed through the SAME machinery
// the delivery service uses: write-model flip (state + completedAt) +
// appendTriWrite (sync_change_feed + fleet_audit_log + outbox projections)
// in one transaction, so the running projection runner heals dispatch_board
// itself. Never raw SQL (event-sourced repair protocol). Idempotent by
// construction: completed runs are terminal and leave the finder set.
//
// 2026 self-healing reconciliation (AWS/Azure/EventSourcingDB/OneUptime):
// LEVEL-triggered (finds delivered-but-incomplete runs regardless of WHY
// the completion transition was missed), so it heals BOTH the intake-lag
// cohort (manifests committed after the client complete-intent window) AND
// the legacy departedAt-proxy cohort (complete was unreachable through the
// old UI). Prod incident this heals: run 165be7fe (order XTT.07-020),
// started 2026-07-11, both stop manifests committed by the Jul-11 intake
// redrive, but no road_run.completed event -- stranded in Dang chay.
//
// Completion counting mirrors assertAllManifestsCommitted EXACTLY (per-run
// count() of stops vs committed manifests over the run orders) rather than
// a raw correlated SQL subquery: the live gate is the single authority on
// what -delivered- means, so reusing its counting method keeps the
// reconciler and the gate in lockstep by construction.
import { and, eq, count, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ROAD_RUN_NON_TERMINAL_STATES } from "@fleet/domain";
import { OUTBOX_QUEUES } from "@fleet/sync-protocol";
import { roadRun, roadRunTransportOrder, stop } from "../database/schema/transport.js";
import { manifest } from "../database/schema/manifest.js";
import { allocateServerSeq } from "../database/server-seq.repository.js";
import { appendTriWrite } from "../database/append-tri-write.js";
import type { FleetDb } from "../database/database.module.js";
// Transaction handle type, identical to appendTriWrite TxLike: this module
// edge-completes inside the caller-owned finalizeIntake tx.
type TxLike = Parameters<Parameters<FleetDb['transaction']>[0]>[0];
import type { OperatorContext } from "../auth/operator-context.js";

export interface DeliveredRunRow {
  readonly roadRunId: string;
  readonly state: string;
}

export interface RepairCompleteDeliveredRunsResult {
  readonly found: number;
  readonly repaired: number;
  readonly dryRun: boolean;
  readonly roadRunIds: readonly string[];
}

// True when EVERY stop across the run orders has a committed manifest
// (committed count >= stop count) with at least one stop. Counts scoped by
// company; identical arithmetic to the live gate assertAllManifestsCommitted.
async function runIsDelivered(
  db: FleetDb,
  companyId: string,
  roadRunId: string,
): Promise<boolean> {
  const orderRows = await db
    .select({ id: roadRunTransportOrder.transportOrderId })
    .from(roadRunTransportOrder)
    .where(and(
      eq(roadRunTransportOrder.roadRunId, roadRunId),
      eq(roadRunTransportOrder.companyId, companyId),
    ));
  const orderIds = orderRows.map((r) => r.id);
  if (orderIds.length === 0) return false;
  const stopCountRows = await db
    .select({ n: count() })
    .from(stop)
    .where(and(
      eq(stop.companyId, companyId),
      inArray(stop.transportOrderId, orderIds),
    ));
  const committedCountRows = await db
    .select({ n: count() })
    .from(manifest)
    .where(and(
      eq(manifest.companyId, companyId),
      inArray(manifest.transportOrderId, orderIds),
      eq(manifest.state, "committed"),
    ));
  /* v8 ignore next 2 -- defensive: a SQL count() aggregate always returns exactly one row, so [0] is never undefined and the ?? 0 fallback is unreachable */
  const stopCount = stopCountRows[0]?.n ?? 0;
  const committed = committedCountRows[0]?.n ?? 0;
  return stopCount > 0 && committed >= stopCount;
}

// Find non-terminal runs that are fully delivered (all stop photos
// committed). Candidate set = non-terminal runs for the company; each is
// tested with runIsDelivered so the -delivered- definition stays identical
// to the live completion gate.
export async function findDeliveredIncompleteRuns(
  db: FleetDb,
  companyId: string,
): Promise<readonly DeliveredRunRow[]> {
  const candidates = await db
    .select({ roadRunId: roadRun.roadRunId, state: roadRun.state })
    .from(roadRun)
    .where(and(
      eq(roadRun.companyId, companyId),
      inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
    ));
  const delivered: DeliveredRunRow[] = [];
  for (const c of candidates) {
    if (await runIsDelivered(db, companyId, c.roadRunId)) {
      delivered.push(c);
    }
  }
  return delivered;
}

// Edge-triggered completion (terminal-29 arc): re-evaluate ONE run the
// instant a manifest commits, rather than waiting for the periodic batch
// reconciler. Called from ManifestService.finalizeIntake inside the commit
// transaction: when the last stop photo commits (however late relative to
// the client complete-intent window), the run is driven started->completed
// through the SAME guarded flip + appendTriWrite(road_run.completed) as the
// batch path, reusing runIsDelivered so the completion predicate stays a
// single authority. Idempotent + guarded: only a still-non-terminal, fully-
// delivered run moves; a concurrent legitimate completion is a no-op. This
// is the durable root fix (2026 process-manager pattern); the batch
// reconciler remains the level-triggered backstop.
export async function completeRunIfDelivered(
  tx: TxLike,
  op: OperatorContext,
  transportOrderId: string,
): Promise<{ readonly completed: boolean; readonly roadRunId: string | null }> {
  const linkRows = await tx
    .select({ roadRunId: roadRunTransportOrder.roadRunId })
    .from(roadRunTransportOrder)
    .where(and(
      eq(roadRunTransportOrder.transportOrderId, transportOrderId),
      eq(roadRunTransportOrder.companyId, op.companyId),
    ));
  const runId = linkRows[0]?.roadRunId;
  if (runId === undefined) return { completed: false, roadRunId: null };
  if (!(await runIsDelivered(tx as never, op.companyId, runId))) {
    return { completed: false, roadRunId: runId };
  }
  const now = new Date();
  const moved = await tx
    .update(roadRun)
    .set({ state: "completed", completedAt: now })
    .where(and(
      eq(roadRun.roadRunId, runId),
      eq(roadRun.companyId, op.companyId),
      inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
    ))
    .returning({ roadRunId: roadRun.roadRunId });
  if (moved.length === 0) return { completed: false, roadRunId: runId };
  const serverSeq = await allocateServerSeq(tx);
  await appendTriWrite(tx, {
    serverSeq,
    actionId: randomUUID(),
    aggregateType: "road_run",
    aggregateId: runId,
    delta: { state: "completed" },
    eventType: "road_run.completed",
    auditPayload: { roadRunId: runId, trigger: "manifest-committed-edge" },
    operatorId: op.operatorId,
    queueName: OUTBOX_QUEUES.PROJECTIONS,
    outboxPayload: {
      aggregateType: "road_run",
      eventType: "road_run.completed",
      roadRunId: runId,
      trigger: "manifest-committed-edge",
    },
    op,
  });
  return { completed: true, roadRunId: runId };
}

export async function repairCompleteDeliveredRuns(
  db: FleetDb,
  op: OperatorContext,
  opts?: { readonly execute?: boolean },
): Promise<RepairCompleteDeliveredRunsResult> {
  const execute = opts?.execute === true;
  const delivered = await findDeliveredIncompleteRuns(db, op.companyId);
  const roadRunIds = delivered.map((d) => d.roadRunId);
  if (!execute) {
    return { found: delivered.length, repaired: 0, dryRun: true, roadRunIds };
  }
  if (roadRunIds.length === 0) {
    return { found: 0, repaired: 0, dryRun: false, roadRunIds };
  }
  let repaired = 0;
  const now = new Date();
  await db.transaction(async (tx) => {
    // Guarded set-based flip: only still-non-terminal rows move (protects
    // against a concurrent legitimate completion between find and flip);
    // events are appended only for rows that ACTUALLY moved.
    const moved = await tx
      .update(roadRun)
      .set({ state: "completed", completedAt: now })
      .where(and(
        inArray(roadRun.roadRunId, [...roadRunIds]),
        eq(roadRun.companyId, op.companyId),
        inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
      ))
      .returning({ roadRunId: roadRun.roadRunId });
    for (const { roadRunId: id } of moved) {
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: "road_run",
        aggregateId: id,
        delta: { state: "completed" },
        eventType: "road_run.completed",
        auditPayload: { roadRunId: id, repair: "delivered-run-compensating-event" },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: {
          aggregateType: "road_run",
          eventType: "road_run.completed",
          roadRunId: id,
          repair: "delivered-run-compensating-event",
        },
        op,
      });
      repaired += 1;
    }
  });
  return { found: delivered.length, repaired, dryRun: false, roadRunIds };
}
