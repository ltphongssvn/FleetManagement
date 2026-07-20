// apps/api/src/manifest/completion-reconcile.repo.ts
// Drizzle adapter for the scheduled completion reconciler ports. Owns the
// transaction boundary the 2026 way: repairTenant opens ONE db.transaction()
// PER TENANT (per-tenant atomic unit of work), so a failure healing one
// company can never roll back another company already healed, and no locks
// span tenant boundaries. The service stays pure of transaction boilerplate
// (Unit-of-Work discipline). Mirrors DrizzleIntakeReconcileRepo, which also
// takes @Inject(DRIZZLE_DB) and opens its own tx per unit of work.
//
// Reuses the completion SSOTs verbatim: findDeliveredIncompleteRuns (finder)
// + the guarded set-flip + appendTriWrite(road_run.completed), so the
// -delivered- predicate and the write machinery stay a single authority
// shared with the edge-trigger (#365) and the manual batch path.
//
// findStrandedTenants discovers the distinct companyIds with >=1 non-terminal
// fully-delivered run -- the tenant-iterating root fix (2026 multi-tenant
// boundary discipline), NOT a single FLEET_PILOT scope. In-test the injected
// handle is the isolation tx, so this repo inner db.transaction() becomes a
// SAVEPOINT (see with-tx-isolation.ts); in prod it is a real transaction.
import { and, eq, inArray } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ROAD_RUN_NON_TERMINAL_STATES } from '@fleet/domain';
import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { roadRun } from '../database/schema/transport.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import { findDeliveredIncompleteRuns } from '../maintenance/repair-complete-delivered-runs.js';
import type { FleetDb } from '../database/database.module.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { CompletionReconcileRepo } from './completion-reconciler.service.js';
@Injectable()
export class DrizzleCompletionReconcileRepo implements CompletionReconcileRepo {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  // Distinct companyIds owning >=1 non-terminal, fully-delivered run. The
  // -delivered- test reuses findDeliveredIncompleteRuns per candidate tenant
  // so the predicate never drifts from the gate. Bounded by limit. Read-only
  // -- no transaction needed.
  async findStrandedTenants(limit: number): Promise<readonly string[]> {
    const tenantRows = await this.db
      .selectDistinct({ companyId: roadRun.companyId })
      .from(roadRun)
      .where(inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES));
    const stranded: string[] = [];
    for (const { companyId } of tenantRows) {
      const delivered = await findDeliveredIncompleteRuns(this.db, companyId);
      if (delivered.length > 0) {
        stranded.push(companyId);
        if (stranded.length >= limit) break;
      }
    }
    return stranded;
  }
  // Heal ONE company inside ONE transaction (per-tenant atomic boundary).
  // Guarded set-flip (still-non-terminal in the WHERE) makes it idempotent +
  // race-safe: a concurrent legit completion moves 0. Event attributed to the
  // injected system operator id with a distinct scheduled trigger tag.
  async repairTenant(companyId: string, systemOperatorId: string, limit: number): Promise<number> {
    const op: OperatorContext = {
      operatorId: systemOperatorId,
      companyId, businessUnitId: companyId, depotId: companyId, legalEntityId: companyId,
    };
    return this.db.transaction(async (tx) => {
      const delivered = await findDeliveredIncompleteRuns(tx as never, companyId);
      const ids = delivered.map((d) => d.roadRunId).slice(0, limit);
      if (ids.length === 0) return 0;
      const now = new Date();
      const moved = await tx
        .update(roadRun)
        .set({ state: 'completed', completedAt: now })
        .where(and(
          inArray(roadRun.roadRunId, ids),
          eq(roadRun.companyId, companyId),
          inArray(roadRun.state, ROAD_RUN_NON_TERMINAL_STATES),
        ))
        .returning({ roadRunId: roadRun.roadRunId });
      let repaired = 0;
      for (const { roadRunId: id } of moved) {
        const serverSeq = await allocateServerSeq(tx);
        await appendTriWrite(tx, {
          serverSeq,
          actionId: randomUUID(),
          aggregateType: 'road_run',
          aggregateId: id,
          delta: { state: 'completed' },
          eventType: 'road_run.completed',
          auditPayload: { roadRunId: id, repair: 'completion-reconcile-scheduled' },
          operatorId: op.operatorId,
          queueName: OUTBOX_QUEUES.PROJECTIONS,
          outboxPayload: {
            aggregateType: 'road_run',
            eventType: 'road_run.completed',
            roadRunId: id,
            trigger: 'completion-reconcile-scheduled',
          },
          op,
        });
        repaired += 1;
      }
      return repaired;
    });
  }
}
