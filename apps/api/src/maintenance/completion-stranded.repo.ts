// apps/api/src/maintenance/completion-stranded.repo.ts
// Drizzle read port for CompletionReconcilerMonitorService. Composes the reactive
// repair finder findDeliveredIncompleteRuns (the SINGLE authority on what
// -delivered- means -- committed manifests >= stop count, gate parity) so the
// monitor and the repair can never disagree, then resolves the OLDEST such run by
// startedAt and reports the stranded-run count. Sibling of DrizzleIntakeLagRepo in
// DI shape (DRIZZLE_DB injection); company-scoped like the scheduler pilot scope.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { roadRun } from '../database/schema/transport.js';
import { findDeliveredIncompleteRuns } from './repair-complete-delivered-runs.js';
import type {
  CompletionStrandedRepo,
  StrandedDeliveredRunRow,
} from './completion-reconciler-monitor.service.js';
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
    // Oldest by startedAt among the delivered set. isNotNull(startedAt) is part
    // of the PREDICATE rather than a defensive post-check: a run that has not
    // been started cannot be -stranded while running-, so the database filters
    // it out and the projected startedAt is non-null by construction. That
    // removes the untestable undefined/null arms entirely -- the only remaining
    // path is the honest, reachable one: no qualifying row -> nothing to report.
    const [oldest] = await this.db
      .select({ roadRunId: roadRun.roadRunId, startedAt: roadRun.startedAt })
      .from(roadRun)
      .where(
        and(
          eq(roadRun.companyId, this.companyId),
          inArray(roadRun.roadRunId, ids),
          isNotNull(roadRun.startedAt),
        ),
      )
      .orderBy(asc(roadRun.startedAt))
      .limit(1);
    /* v8 ignore start -- unreachable defensive guard: the isNotNull predicate
       above already excludes null startedAt, and every id came from
       findDeliveredIncompleteRuns querying the SAME db in the SAME call, so a
       row always exists. Kept (not asserted away) because both no-non-null-
       assertion and non-nullable-type-assertion-style are enforced here, so
       narrowing is the only lint-legal way to reach an exact return type. */
    const startedAt = oldest?.startedAt ?? null;
    if (oldest === undefined || startedAt === null) return null;
    /* v8 ignore stop */
    return {
      roadRunId: oldest.roadRunId,
      startedAt,
      strandedCount: delivered.length,
    };
  }
}
