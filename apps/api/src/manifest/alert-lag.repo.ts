// apps/api/src/manifest/alert-lag.repo.ts
// S6b (T12 driver-order-alerts): Drizzle adapter for the alert-lag monitor read
// port. Reads the outbox filtered to driver_alert rows (payload aggregateType)
// and produces the AlertLagSnapshot the monitor branches on. Sibling of
// DrizzleIntakeLagRepo in DI shape (DRIZZLE_DB injection).
//
// Three reads, in the order the monitor needs them:
//   1) deadLetterCount  -- status = dead_letter (permanent misses)
//   2) oldest pending    -- status IN (pending, failed), oldest by created_at
//   3) pendingCount      -- status IN (pending, failed) tally
// An all-sent history returns a ZEROED snapshot, not null, so a later stall is
// measured against a live baseline rather than suppressed.
//
// The jsonb aggregateType filter uses sql.raw with a plain string (house
// convention, see transport.ts): zero backticks keeps the file heredoc-safe.
// The driver_alert literal matches what emission stamps
// (transport-orders.service.ts) and the routing policy reads.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { outbox } from '../database/schema/index.js';
import type { AlertLagRepo, AlertLagSnapshot } from './alert-lag-monitor.service.js';

@Injectable()
export class DrizzleAlertLagRepo implements AlertLagRepo {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async snapshot(): Promise<AlertLagSnapshot | null> {
    const driverAlert = sql.raw("(payload ->> 'aggregateType') = 'driver_alert'");
    const pendingStatuses = inArray(outbox.status, ['pending', 'failed']);

    const [deadTally] = await this.db
      .select({ n: count() })
      .from(outbox)
      .where(and(driverAlert, eq(outbox.status, 'dead_letter')));
    const deadLetterCount = deadTally?.n ?? 0;

    const [oldest] = await this.db
      .select({ outboxId: outbox.outboxId, createdAt: outbox.createdAt })
      .from(outbox)
      .where(and(driverAlert, pendingStatuses))
      .orderBy(asc(outbox.createdAt))
      .limit(1);

    if (oldest === undefined) {
      return {
        deadLetterCount,
        oldestPendingId: null,
        oldestPendingCreatedAt: null,
        pendingCount: 0,
      };
    }

    const [pendingTally] = await this.db
      .select({ n: count() })
      .from(outbox)
      .where(and(driverAlert, pendingStatuses));

    return {
      deadLetterCount,
      oldestPendingId: oldest.outboxId,
      oldestPendingCreatedAt: oldest.createdAt,
      pendingCount: pendingTally?.n ?? 1,
    };
  }
}
