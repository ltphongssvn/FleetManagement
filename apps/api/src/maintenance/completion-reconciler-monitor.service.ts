// apps/api/src/maintenance/completion-reconciler-monitor.service.ts
// PROACTIVE regression guard for the stranded-completed-delivery incident class
// (Task 1 / PR #297): a delivered road_run (every stop photo committed) that never
// transitioned started->completed, so its order stayed stuck in Dang chay instead
// of Da hoan tat. Root cause was the driver client complete-intent window closing
// before the async intake redrive committed the manifests -- the completion event
// was never emitted and no human reopens a done order. Task 1 shipped the REACTIVE
// repair (findDeliveredIncompleteRuns + a compensating road_run.completed event);
// this monitor is the PROACTIVE half: it watches the OUTCOME -- the age of the
// oldest delivered-but-non-terminal run -- so ANY future recurrence (intake stall,
// client gap, relay lag) pages within one threshold window regardless of cause.
//
// Sibling of IntakeLagMonitorService (same shape): Sentry fatal is the paging seam
// (fingerprint road-run-completion-stranded). Episode semantics: ONE fatal per
// stranded episode. The flag re-arms when the backlog recovers (no stranded run,
// or the oldest back under threshold), so a sustained strand cannot spam an event
// per tick, and a NEW strand after recovery pages again. In-memory flag: a process
// restart during a strand re-pages once -- acceptable and desirable (still live).
//
// The repo port is intentionally a plain internal interface (single-use service
// seam, crosses no trust boundary, not duplicated) -- schema-first Zod is not
// applicable here, mirroring IntakeLagRepo.
import * as Sentry from '@sentry/nestjs';
export interface StrandedDeliveredRunRow {
  readonly roadRunId: string;
  readonly startedAt: Date;
  readonly strandedCount: number;
}
export interface CompletionStrandedRepo {
  /** Oldest non-terminal road_run that is fully delivered (all stop photos committed), by startedAt; null when none. */
  oldestStrandedDeliveredRun(): Promise<StrandedDeliveredRunRow | null>;
}
export class CompletionReconcilerMonitorService {
  private stranded = false;
  constructor(
    private readonly repo: CompletionStrandedRepo,
    private readonly thresholdMinutes: number,
    private readonly now: () => number = Date.now,
  ) {}
  async checkOnce(): Promise<void> {
    const oldest = await this.repo.oldestStrandedDeliveredRun();
    if (oldest === null) {
      this.stranded = false;
      return;
    }
    const ageMs = this.now() - oldest.startedAt.getTime();
    const thresholdMs = this.thresholdMinutes * 60_000;
    if (ageMs <= thresholdMs) {
      this.stranded = false;
      return;
    }
    if (this.stranded) return;
    this.stranded = true;
    const oldestAgeMinutes = Math.floor(ageMs / 60_000);
    Sentry.captureEvent({
      level: 'fatal',
      message:
        'Completion reconciler: oldest delivered-but-stranded road_run is ' +
        String(oldestAgeMinutes) +
        ' minutes past start (threshold ' +
        String(this.thresholdMinutes) +
        'm, stranded ' +
        String(oldest.strandedCount) +
        ')',
      tags: { pipeline_event: 'completion_stranded' },
      extra: {
        oldestRoadRunId: oldest.roadRunId,
        strandedCount: oldest.strandedCount,
        oldestAgeMinutes,
        thresholdMinutes: this.thresholdMinutes,
      },
      fingerprint: ['road-run-completion-stranded'],
    });
  }
}
