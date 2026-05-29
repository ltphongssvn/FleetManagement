// apps/api/src/metrics/metrics.service.ts
// Lightweight metrics for PDF Day-One #9 alerts: "outbox DLQ > 10 or sync p95 > 5s".
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { outbox } from '../database/schema/index.js';

const OUTBOX_DLQ_ALERT_THRESHOLD = 10;

export interface MetricsSnapshot {
  readonly outboxDeadLetterDepth: number;
  readonly alerts: readonly string[];
  readonly capturedAt: string;
}

@Injectable()
export class MetricsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async snapshot(): Promise<MetricsSnapshot> {
    const rows = await this.db
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(outbox)
      .where(eq(outbox.status, 'dead_letter'));
    const depth = Number(rows[0]?.count ?? '0');
    const alerts: string[] = [];
    if (depth >= OUTBOX_DLQ_ALERT_THRESHOLD) alerts.push('outbox_dlq_high');
    return {
      outboxDeadLetterDepth: depth,
      alerts,
      capturedAt: new Date().toISOString(),
    };
  }
}
