// apps/api/src/manifest/intake-lag.repo.ts
// Drizzle adapter for the intake-lag monitor's read port. One aggregate
// roundtrip: oldest verifying manifest (state=verifying AND committedAt IS
// NULL) plus the backlog count. Sibling of KeycloakEventPollCursorService in
// DI shape (DRIZZLE_DB injection).
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { manifest } from '../database/schema/manifest.js';
import type { IntakeLagOldestRow, IntakeLagRepo } from './intake-lag-monitor.service.js';

@Injectable()
export class DrizzleIntakeLagRepo implements IntakeLagRepo {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async oldestVerifying(): Promise<IntakeLagOldestRow | null> {
    const verifyingWhere = and(eq(manifest.state, 'verifying'), isNull(manifest.committedAt));
    const [oldest] = await this.db
      .select({ manifestId: manifest.manifestId, createdAt: manifest.createdAt })
      .from(manifest)
      .where(verifyingWhere)
      .orderBy(asc(manifest.createdAt))
      .limit(1);
    if (oldest === undefined) return null;
    const [tally] = await this.db.select({ n: count() }).from(manifest).where(verifyingWhere);
    return {
      manifestId: oldest.manifestId,
      createdAt: oldest.createdAt,
      verifyingCount: tally?.n ?? 1,
    };
  }
}
