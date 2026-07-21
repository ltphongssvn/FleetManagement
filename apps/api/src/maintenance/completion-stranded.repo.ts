// apps/api/src/maintenance/completion-stranded.repo.ts
// Drizzle read port for CompletionReconcilerMonitorService. Composes the reactive
// repair finder findDeliveredIncompleteRuns (the SINGLE authority on what
// -delivered- means -- committed manifests >= stop count, gate parity) so the
// monitor and the repair can never disagree, then resolves the OLDEST such run by
// startedAt and reports the stranded-run count. Sibling of DrizzleIntakeLagRepo in
// DI shape (DRIZZLE_DB injection); company-scoped like the scheduler pilot scope.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { roadRun } from '../database/schema/transport.js';
import { findDeliveredIncompleteRuns } from './repair-complete-delivered-runs.js';
import type { CompletionStrandedRepo, StrandedDeliveredRunRow } from './completion-reconciler-monitor.service.js';
export const COMPLETION_STRANDED_PILOT_SCOPE = 'COMPLETION_STRANDED_PILOT_SCOPE' as const;
@Injectable()
export class DrizzleCompletionStrandedRepo implements CompletionStrandedRepo {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(COMPLETION_STRANDED_PILOT_SCOPE) private readonly companyId: string,
  ) {}
  async oldestStrandedDeliveredRun(): Promise<StrandedDeliveredRunRow | null> {
    const delivered = await findDeliveredIncompleteRuns(this.db, this.companyId);
    if (delivered.length === 0) return null;
    const ids = delivered.map((d) => d.roadRunId);
    // Oldest by startedAt among the delivered set. startedAt is non-null for any
    // run that has been started (all delivered runs have been); order asc, take 1.
    const [oldest] = await this.db
      .select({ roadRunId: roadRun.roadRunId, startedAt: roadRun.startedAt })
      .from(roadRun)
      .where(and(
        eq(roadRun.companyId, this.companyId),
        inArray(roadRun.roadRunId, ids),
      ))
      .orderBy(asc(roadRun.startedAt))
      .limit(1);
    // Optional-chain the row access (prefer-optional-chain); null startedAt or a
    // missing row both mean no stranded run to report. Both guards are defensive:
    // the ids came from findDeliveredIncompleteRuns querying the SAME db in the
    // SAME call, so a row for one of them always exists, and a delivered run has
    // by definition been started (startedAt non-null). Unreachable in practice.
    const startedAt = oldest?.startedAt ?? null;
    /* v8 ignore next 2 -- defensive: oldest is always present (ids came from the same query) and a delivered run is always started */
    if (oldest === undefined || startedAt === null) return null;
    return {
      roadRunId: oldest.roadRunId,
      startedAt,
      strandedCount: delivered.length,
    };
  }
}
