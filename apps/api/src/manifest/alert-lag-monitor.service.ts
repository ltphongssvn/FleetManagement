// apps/api/src/manifest/alert-lag-monitor.service.ts
// S6a (T12 driver-order-alerts): production guard for the driver-alert
// pipeline. The alert path (order create -> outbox row -> relay -> BullMQ ->
// consumer -> Expo push) can break SILENTLY: a dead-lettered alert row means a
// driver definitely will NOT be alerted; a row stuck pending/failed past a
// threshold means the relay/queue/consumer chain stalled. Either way a driver
// can miss a 4AM job with no visible signal. This monitor watches the pipeline
// OUTCOME (the outbox for aggregateType=driver_alert) so ANY break pages within
// one threshold window regardless of cause. Sibling of IntakeLagMonitorService;
// Sentry fatal is the paging seam (fingerprint driver-alert-pipeline-stalled).
//
// Episode semantics: ONE fatal per stall episode. The flag re-arms when the
// backlog recovers (no dead-letters and no over-threshold pending), so a
// sustained stall cannot spam an event per tick and a NEW stall after recovery
// pages again. In-memory flag: a process restart during a stall re-pages once
// -- acceptable and desirable (the stall is still live).
//
// Two failure modes:
//  - deadLetterCount > 0: permanent loss. Pages regardless of age -- the alert
//    is already gone, waiting does not help.
//  - oldest pending/failed alert older than thresholdMinutes: stuck pipeline.
import * as Sentry from '@sentry/nestjs';

/** One aggregate read of the driver_alert outbox health. */
export interface AlertLagSnapshot {
  /** driver_alert rows in status=dead_letter. Any > 0 is a permanent miss. */
  readonly deadLetterCount: number;
  /** Oldest driver_alert row still pending/failed (not yet sent); null if none. */
  readonly oldestPendingId: string | null;
  readonly oldestPendingCreatedAt: Date | null;
  /** Count of driver_alert rows still pending/failed. */
  readonly pendingCount: number;
}

export interface AlertLagRepo {
  snapshot(): Promise<AlertLagSnapshot | null>;
}

export class AlertLagMonitorService {
  private stalled = false;

  constructor(
    private readonly repo: AlertLagRepo,
    private readonly thresholdMinutes: number,
    private readonly now: () => number = Date.now,
  ) {}

  async checkOnce(): Promise<void> {
    const snap = await this.repo.snapshot();
    if (snap === null) {
      this.stalled = false;
      return;
    }

    const thresholdMs = this.thresholdMinutes * 60_000;
    const oldestAgeMs =
      snap.oldestPendingCreatedAt === null ? 0 : this.now() - snap.oldestPendingCreatedAt.getTime();

    const hasDeadLetter = snap.deadLetterCount > 0;
    const hasStuckPending = snap.oldestPendingCreatedAt !== null && oldestAgeMs > thresholdMs;

    if (!hasDeadLetter && !hasStuckPending) {
      this.stalled = false;
      return;
    }
    if (this.stalled) return;
    this.stalled = true;

    const oldestAgeMinutes = Math.floor(oldestAgeMs / 60_000);
    Sentry.captureEvent({
      level: 'fatal',
      message:
        'Driver-alert pipeline stalled: ' +
        String(snap.deadLetterCount) +
        ' dead-lettered, ' +
        String(snap.pendingCount) +
        ' pending (oldest ' +
        String(oldestAgeMinutes) +
        'm, threshold ' +
        String(this.thresholdMinutes) +
        'm)',
      tags: { pipeline_event: 'driver_alert_stalled' },
      extra: {
        deadLetterCount: snap.deadLetterCount,
        pendingCount: snap.pendingCount,
        oldestPendingId: snap.oldestPendingId,
        oldestAgeMinutes,
        thresholdMinutes: this.thresholdMinutes,
      },
      fingerprint: ['driver-alert-pipeline-stalled'],
    });
  }
}
