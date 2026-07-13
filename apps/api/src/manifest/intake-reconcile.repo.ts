// apps/api/src/manifest/intake-reconcile.repo.ts
// Drizzle adapter for the intake reconciler ports. Sibling of
// DrizzleIntakeLagRepo (DRIZZLE_DB injection). The eligibility and
// backoff arithmetic live in SQL so a single indexed scan drives each
// tick; redriveOnce is an optimistic-concurrency tx (guarded on the read
// attempts value) reusing the shared redrive builder + server-seq
// allocator, so a duplicate tick loses the race instead of double-emitting.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { outbox } from '../database/schema/append-paths.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { buildIntakeRedriveOutboxValues } from './intake-redrive.builder.js';
import type {
  IntakeExhaustedSummary,
  IntakeReconcileCandidate,
  IntakeReconcileRepo,
} from './intake-reconciler.service.js';
// Exponential-backoff gate: a manifest is due again once
// now >= lastIntakeReconcileAt + afterMinutes * 2^attempts (capped 240m).
// Expressed in SQL as an interval of the computed minutes. A NULL
// lastIntakeReconcileAt (never attempted) is always due once past the
// createdAt freshness gate.
const BACKOFF_CAP_MINUTES = 240;
@Injectable()
export class DrizzleIntakeReconcileRepo implements IntakeReconcileRepo {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  private verifyingWhere(): SQL | undefined {
    return and(eq(manifest.state, 'verifying'), isNull(manifest.committedAt));
  }
  private freshnessCutoff(now: Date, afterMinutes: number): Date {
    return new Date(now.getTime() - afterMinutes * 60_000);
  }
  async findEligible(now: Date, afterMinutes: number, maxAttempts: number, limit: number): Promise<readonly IntakeReconcileCandidate[]> {
    const cutoff = this.freshnessCutoff(now, afterMinutes);
    const backoffDue = or(
      isNull(manifest.lastIntakeReconcileAt),
      lt(
        sql`${manifest.lastIntakeReconcileAt} + make_interval(mins => LEAST(${afterMinutes} * power(2, ${manifest.intakeReconcileAttempts})::int, ${BACKOFF_CAP_MINUTES}))`,
        now,
      ),
    );
    const rows = await this.db
      .select({
        companyId: manifest.companyId,
        businessUnitId: manifest.businessUnitId,
        depotId: manifest.depotId,
        legalEntityId: manifest.legalEntityId,
        manifestId: manifest.manifestId,
        createdAt: manifest.createdAt,
        attempts: manifest.intakeReconcileAttempts,
        uploadSessionId: uploadSession.uploadSessionId,
        s3Key: uploadSession.s3Key,
        s3Bucket: uploadSession.s3Bucket,
        contentType: uploadSession.contentType,
        expectedSizeBytes: uploadSession.expectedSizeBytes,
        actualSizeBytes: uploadSession.actualSizeBytes,
        contentHash: uploadSession.contentHash,
      })
      .from(manifest)
      .innerJoin(uploadSession, eq(uploadSession.manifestId, manifest.manifestId))
      .where(and(
        this.verifyingWhere(),
        lt(manifest.createdAt, cutoff),
        lt(manifest.intakeReconcileAttempts, maxAttempts),
        backoffDue,
      ))
      .orderBy(asc(manifest.createdAt))
      .limit(limit);
    return rows;
  }
  async redriveOnce(candidate: IntakeReconcileCandidate, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Optimistic guard: only claim this manifest if attempts still equals
      // the value we read (another concurrent tick would have incremented
      // it). No row updated => we lost the race, emit nothing.
      const claimed = await tx
        .update(manifest)
        .set({
          intakeReconcileAttempts: candidate.attempts + 1,
          lastIntakeReconcileAt: now,
        })
        .where(and(
          eq(manifest.manifestId, candidate.manifestId),
          eq(manifest.intakeReconcileAttempts, candidate.attempts),
          eq(manifest.state, 'verifying'),
        ))
        .returning({ manifestId: manifest.manifestId });
      if (claimed.length === 0) return false;
      const seq = await allocateServerSeq(tx);
      const values = buildIntakeRedriveOutboxValues(candidate, seq);
      await tx.insert(outbox).values(values);
      return true;
    });
  }
  async exhaustedSummary(now: Date, afterMinutes: number, maxAttempts: number): Promise<IntakeExhaustedSummary | null> {
    const cutoff = this.freshnessCutoff(now, afterMinutes);
    const [oldest] = await this.db
      .select({ manifestId: manifest.manifestId, createdAt: manifest.createdAt })
      .from(manifest)
      .where(and(
        this.verifyingWhere(),
        lt(manifest.createdAt, cutoff),
        sql`${manifest.intakeReconcileAttempts} >= ${maxAttempts}`,
      ))
      .orderBy(asc(manifest.createdAt))
      .limit(1);
    if (oldest === undefined) return null;
    const [tally] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(manifest)
      .where(and(
        this.verifyingWhere(),
        lt(manifest.createdAt, cutoff),
        sql`${manifest.intakeReconcileAttempts} >= ${maxAttempts}`,
      ));
    return {
      count: tally?.n ?? 1,
      oldestManifestId: oldest.manifestId,
      oldestAgeMinutes: Math.floor((now.getTime() - oldest.createdAt.getTime()) / 60_000),
    };
  }
}
