// apps/api/src/maintenance/repair-ghost-runs.ts
// Event-sourced repair (T9 ghost-run arc, 2026-07-11): find non-terminal
// road_runs whose linked transport_orders are ALL terminal (ghosts) or
// that have ZERO links (orphans) and cancel them through the SAME
// machinery the cancel-service cascade uses -- write-model flip +
// appendTriWrite (sync_change_feed + fleet_audit_log + outbox) in one
// transaction -- so the running projection runner heals dispatch_board
// itself. Never raw SQL (event-sourced repair protocol). Idempotent by
// construction: repaired runs become terminal and leave the finder set.
// Prod incident this heals: road_run dd964ecd (started since Jun-02,
// only order XTT.06-002 cancelled by the admin-drivers-update raw path
// with no run cascade and no event).
import { and, eq, inArray, notExists } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ROAD_RUN_NON_TERMINAL_STATES, TRANSPORT_ORDER_NON_TERMINAL_STATES } from '@fleet/domain';
import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
import { roadRun, transportOrder, roadRunTransportOrder } from '../database/schema/transport.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import type { FleetDb } from '../database/database.module.js';
import type { OperatorContext } from '../auth/operator-context.js';
export interface GhostRunRow {
  readonly roadRunId: string;
  readonly state: string;
}
export interface RepairGhostRunsResult {
  readonly found: number;
  readonly repaired: number;
  readonly dryRun: boolean;
  readonly roadRunIds: readonly string[];
}
// A run is BUSY-relevant only while it has >=1 linked order in a
// non-terminal state (mirrors runHasLiveLinkedOrder in
// reference.service). Ghost = non-terminal run failing that predicate.
export async function findGhostRuns(db: FleetDb, companyId: string): Promise<readonly GhostRunRow[]> {
  return db
    .select({ roadRunId: roadRun.roadRunId, state: roadRun.state })
    .from(roadRun)
    .where(and(
      eq(roadRun.companyId, companyId),
      inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
      notExists(
        db
          .select({ one: roadRunTransportOrder.roadRunId })
          .from(roadRunTransportOrder)
          .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
          .where(and(
            eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId),
            inArray(transportOrder.state, TRANSPORT_ORDER_NON_TERMINAL_STATES),
          )),
      ),
    ));
}
export async function repairGhostRuns(
  db: FleetDb,
  op: OperatorContext,
  opts?: { readonly execute?: boolean },
): Promise<RepairGhostRunsResult> {
  const execute = opts?.execute === true;
  const ghosts = await findGhostRuns(db, op.companyId);
  const roadRunIds = ghosts.map((g) => g.roadRunId);
  if (!execute) {
    return { found: ghosts.length, repaired: 0, dryRun: true, roadRunIds };
  }
  let repaired = 0;
  await db.transaction(async (tx) => {
    for (const id of roadRunIds) {
      // Guarded flip: only a still-non-terminal row moves (protects
      // against concurrent legitimate completion/cancellation between
      // the find and the flip).
      const moved = await tx
        .update(roadRun)
        .set({ state: 'cancelled' })
        .where(and(
          eq(roadRun.roadRunId, id),
          eq(roadRun.companyId, op.companyId),
          inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
        ))
        .returning({ roadRunId: roadRun.roadRunId });
      if (moved.length === 0) continue;
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: 'road_run',
        aggregateId: id,
        delta: { state: 'cancelled' },
        eventType: 'road_run.cancelled',
        auditPayload: { roadRunId: id, repair: 'ghost-run-compensating-event' },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: {
          aggregateType: 'road_run',
          eventType: 'road_run.cancelled',
          roadRunId: id,
          repair: 'ghost-run-compensating-event',
        },
        op,
      });
      repaired += 1;
    }
  });
  return { found: ghosts.length, repaired, dryRun: false, roadRunIds };
}
