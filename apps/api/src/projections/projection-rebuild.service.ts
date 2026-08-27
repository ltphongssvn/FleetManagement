// apps/api/src/projections/projection-rebuild.service.ts
// The sanctioned "rebuild second" path (event-repair first, rebuild second,
// never manual read-model patch). Rebuilds one scope's dispatch_board_projection
// to its event-derived truth by replaying sync_change_feed from server_seq 0
// through the SAME ProjectionRunnerService the live system uses.
//
// 2026 practice applied:
//  - reset-checkpoint-then-replay: set the scope's watermark to 0, then drain.
//  - @ResetHandler "clear before replay" to avoid additive corruption: hide the
//    scope's current projection rows first (soft-delete via deleted_at, since the
//    app role holds NO physical DELETE). The runner's upsert path re-activates
//    every row the replay re-emits (deleted_at -> null); any row the replay does
//    NOT re-emit stays hidden, so drift and orphans are cleared.
//  - idempotent + resumable: replay loops drainOnce (which is itself idempotent
//    and watermarked) until a batch returns fewer than POLL_BATCH_SIZE events.
//  - audit marker: stamp projection_status.last_rebuilt_at (its documented
//    purpose; NOT touched by incremental drains) so a rebuild is observable
//    without inspecting row diffs.
//
// This never issues an ad-hoc UPDATE against the read model's business columns:
// every projection-row mutation flows through the runner's event application.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DISPATCH_BOARD_PROJECTION_NAME } from '@fleet/domain';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { dispatchBoardProjection, projectionStatus } from '../database/schema/index.js';
import { ProjectionRunnerService } from './projection-runner.service.js';

// Matches ProjectionRunnerService POLL_BATCH_SIZE; a full batch means "more may
// remain", so keep draining until a short batch proves the feed is exhausted.
const POLL_BATCH_SIZE = 200;
// Safety bound: even a pathological feed cannot loop forever. 200 * 100000 =
// 20M events per rebuild, far beyond pilot scale; exceeding it is a bug/abuse.
const MAX_DRAIN_ITERATIONS = 100_000;

export interface RebuildResult {
  readonly scope: string;
  readonly rebuilt: true;
  readonly drains: number;
  readonly applied: number;
  readonly softDeletes: number;
  readonly finalWatermark: string;
}

@Injectable()
export class ProjectionRebuildService {
  private readonly logger = new Logger(ProjectionRebuildService.name);
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(ProjectionRunnerService) private readonly runner: ProjectionRunnerService,
  ) {}

  /**
   * Rebuild dispatch_board_projection for one scope (companyId) from the event
   * feed. Safe to run on a live scope: reads converge on event truth and any
   * row the feed no longer produces is hidden.
   */
  async rebuild(scope: string): Promise<RebuildResult> {
    // (1) Clear-before-replay + (2) reset checkpoint, atomically, so a crash
    // between them cannot leave a zero watermark against un-hidden stale rows.
    await this.db.transaction(async (tx) => {
      await tx
        .insert(projectionStatus)
        .values({ projectionName: DISPATCH_BOARD_PROJECTION_NAME, scope, watermark: 0n, lagMs: 0 })
        .onConflictDoNothing();
      // Hide all currently-active rows for this scope (soft delete; app role has
      // no DELETE). Re-emitted rows are re-activated by the runner's upsert.
      await tx
        .update(dispatchBoardProjection)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(dispatchBoardProjection.companyId, scope),
            isNull(dispatchBoardProjection.deletedAt),
          ),
        );
      // Reset the watermark to 0 so the replay reprocesses the entire feed.
      await tx
        .update(projectionStatus)
        .set({ watermark: 0n, updatedAt: new Date() })
        .where(
          and(
            eq(projectionStatus.projectionName, DISPATCH_BOARD_PROJECTION_NAME),
            eq(projectionStatus.scope, scope),
          ),
        );
    });

    // (3) Replay the whole feed via the live runner. drainOnce is idempotent and
    // advances the watermark; loop until a short batch proves exhaustion.
    let drains = 0;
    let applied = 0;
    let softDeletes = 0;
    let finalWatermark = '0';
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i += 1) {
      const res = await this.runner.drainOnce(scope);
      drains += 1;
      applied += res.applied;
      softDeletes += res.softDeletes;
      finalWatermark = res.newWatermark;
      if (res.polled < POLL_BATCH_SIZE) break;
    }

    // (4) Stamp the audit marker. last_rebuilt_at is documented as NOT updated by
    // incremental drains, so it uniquely records rebuild operations.
    await this.db
      .update(projectionStatus)
      .set({ lastRebuiltAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(projectionStatus.projectionName, DISPATCH_BOARD_PROJECTION_NAME),
          eq(projectionStatus.scope, scope),
        ),
      );

    this.logger.log(
      `[projection ${DISPATCH_BOARD_PROJECTION_NAME} scope=${scope}] REBUILT drains=${String(drains)} applied=${String(applied)} softDeletes=${String(softDeletes)} finalWatermark=${finalWatermark}`,
    );
    return { scope, rebuilt: true, drains, applied, softDeletes, finalWatermark };
  }
}
