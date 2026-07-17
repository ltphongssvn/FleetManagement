// apps/api/src/manifest/intake-reconciler.service.ts
// Self-healing reconciliation loop (2026 level-based pattern) for the
// Jun-24 incident class: manifests stranded in verifying by ANY break in
// the intake loop. Twin of IntakeLagMonitorService (pure service, injected
// repo/knobs/clock; scheduler tick). Observe actual state (stalled
// verifying rows), compare against desired (none older than AFTER),
// act idempotently (re-emit the compensating manifest_intake.requested
// event through the SAME outbox pipeline the producer and the manual
// intake:redrive use). Bounded per-manifest attempts with exponential
// backoff (AFTER * 2^attempts, capped 240m) persisted in DB (restart-reset
// counters are the named anti-pattern); batch size per tick is the fleet
// retry budget. Exhaustion = quarantine-in-place: rows STAY verifying
// (state is never hand-patched; finalizeIntake is the only writer), ONE
// Sentry fatal per episode (fingerprint intake-reconcile-exhausted, flag
// re-arms when the quarantined set clears), the lag monitor keeps aging
// pressure, and the deliberate post-fix replay is the manual
// intake:redrive (which ignores this gate by design).
import * as Sentry from '@sentry/nestjs';
import type { IntakeRedriveCandidate } from './intake-redrive.builder.js';
export interface IntakeReconcileCandidate extends IntakeRedriveCandidate {
  readonly createdAt: Date;
  readonly attempts: number;
}
export interface IntakeExhaustedSummary {
  readonly count: number;
  readonly oldestManifestId: string;
  readonly oldestAgeMinutes: number;
}
export interface IntakeReconcileRepo {
  /** Stalled verifying manifests eligible NOW: older than afterMinutes,
   *  attempts < maxAttempts, and past the exponential-backoff gate from
   *  lastIntakeReconcileAt. Oldest-first, capped at limit (retry budget). */
  findEligible(now: Date, afterMinutes: number, maxAttempts: number, limit: number): Promise<readonly IntakeReconcileCandidate[]>;
  /** ONE tx: optimistic attempts+1 (guarded on the read attempts value),
   *  lastIntakeReconcileAt=now, allocateServerSeq, outbox insert via
   *  buildIntakeRedriveOutboxValues. Returns true iff the event was
   *  emitted (false = lost the optimistic race; another tick owns it). */
  redriveOnce(candidate: IntakeReconcileCandidate, now: Date): Promise<boolean>;
  /** Quarantined set: verifying rows older than afterMinutes with
   *  attempts >= maxAttempts; null when none. */
  exhaustedSummary(now: Date, afterMinutes: number, maxAttempts: number): Promise<IntakeExhaustedSummary | null>;
}
export interface IntakeReconcileResult {
  readonly eligible: number;
  readonly emitted: number;
  readonly exhausted: number;
}
export class IntakeReconcilerService {
  private exhaustedEpisode = false;
  constructor(
    private readonly repo: IntakeReconcileRepo,
    private readonly afterMinutes: number,
    private readonly maxAttempts: number,
    private readonly batchSize: number,
    private readonly now: () => number = Date.now,
  ) {}
  async reconcileOnce(): Promise<IntakeReconcileResult> {
    const now = new Date(this.now());
    const eligible = await this.repo.findEligible(now, this.afterMinutes, this.maxAttempts, this.batchSize);
    let emitted = 0;
    for (const candidate of eligible) {
      if (await this.repo.redriveOnce(candidate, now)) emitted += 1;
    }
    const summary = await this.repo.exhaustedSummary(now, this.afterMinutes, this.maxAttempts);
    if (summary === null) {
      this.exhaustedEpisode = false;
      return { eligible: eligible.length, emitted, exhausted: 0 };
    }
    if (!this.exhaustedEpisode) {
      this.exhaustedEpisode = true;
      Sentry.captureEvent({
        level: 'fatal',
        message:
          'Intake reconcile exhausted: ' +
          String(summary.count) +
          ' manifest(s) at max attempts (' +
          String(this.maxAttempts) +
          '), oldest ' +
          String(summary.oldestAgeMinutes) +
          ' minutes',
        tags: { pipeline_event: 'intake_reconcile_exhausted' },
        extra: {
          exhaustedCount: summary.count,
          oldestManifestId: summary.oldestManifestId,
          oldestAgeMinutes: summary.oldestAgeMinutes,
          maxAttempts: this.maxAttempts,
        },
        fingerprint: ['intake-reconcile-exhausted'],
      });
    }
    return { eligible: eligible.length, emitted, exhausted: summary.count };
  }
}
