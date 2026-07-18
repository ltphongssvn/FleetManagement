// apps/api/src/manifest/intake-lag-monitor.service.ts
// Regression guard for the Jun-24 incident class: the intake pipeline broke
// (worker callbacks 401ed on a decayed static token) and ran SILENT for 17
// days while manifests piled up in verifying. This monitor watches the
// pipeline OUTCOME -- the oldest verifying manifest age -- so ANY break in
// the loop (auth, queue, worker crash-loop, relay stall) pages within one
// threshold window regardless of cause. Sibling of
// BreakGlassLoginMonitorService: Sentry fatal is the paging seam
// (fingerprint intake-pipeline-stalled).
// Episode semantics: ONE fatal per stall episode. The flag re-arms when the
// backlog recovers (no rows, or oldest back under threshold), so a sustained
// stall cannot spam an event per tick, and a NEW stall after recovery pages
// again. In-memory flag: a process restart during a stall re-pages once --
// acceptable and desirable (the stall is still live).
import * as Sentry from '@sentry/nestjs';

export interface IntakeLagOldestRow {
  readonly manifestId: string;
  readonly createdAt: Date;
  readonly verifyingCount: number;
}

export interface IntakeLagRepo {
  /** Oldest manifest in state=verifying (committedAt IS NULL), with backlog count; null when none. */
  oldestVerifying(): Promise<IntakeLagOldestRow | null>;
}

export class IntakeLagMonitorService {
  private stalled = false;

  constructor(
    private readonly repo: IntakeLagRepo,
    private readonly thresholdMinutes: number,
    private readonly now: () => number = Date.now,
  ) {}

  async checkOnce(): Promise<void> {
    const oldest = await this.repo.oldestVerifying();
    if (oldest === null) {
      this.stalled = false;
      return;
    }
    const ageMs = this.now() - oldest.createdAt.getTime();
    const thresholdMs = this.thresholdMinutes * 60_000;
    if (ageMs <= thresholdMs) {
      this.stalled = false;
      return;
    }
    if (this.stalled) return;
    this.stalled = true;
    const oldestAgeMinutes = Math.floor(ageMs / 60_000);
    Sentry.captureEvent({
      level: 'fatal',
      message:
        'Intake pipeline stalled: oldest verifying manifest is ' +
        String(oldestAgeMinutes) +
        ' minutes old (threshold ' +
        String(this.thresholdMinutes) +
        'm, backlog ' +
        String(oldest.verifyingCount) +
        ')',
      tags: { pipeline_event: 'intake_stalled' },
      extra: {
        oldestManifestId: oldest.manifestId,
        verifyingCount: oldest.verifyingCount,
        oldestAgeMinutes,
        thresholdMinutes: this.thresholdMinutes,
      },
      fingerprint: ['intake-pipeline-stalled'],
    });
  }
}
