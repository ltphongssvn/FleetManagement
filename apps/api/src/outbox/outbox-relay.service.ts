// apps/api/src/outbox/outbox-relay.service.ts
// Polls outbox table for pending rows, routes via shared @fleet/sync-protocol
// routing policy, enqueues to BullMQ, and marks rows as 'sent' or 'dead_letter'.
//
// Frozen Stack PDF: "Three append paths, same tx: fleet_audit_log + sync_change_feed
// + outbox" + Day-One #8 "Outbox -> erp queue -> ERP sandbox".
//
// Concurrency safety: claim rows with `FOR UPDATE SKIP LOCKED` so overlapping
// drainOnce calls (or future multi-instance deploys) never double-process the
// same row.
//
// Payload validation: every outbox row is parsed against OutboxPayloadSchema
// before routing. Schema-shape failures dead-letter immediately as
// invalid_payload (distinguishable from unknown_aggregate / unknown_event_type).
//
// We never wrap BullMQ enqueue inside a Postgres tx: the outbox pattern exists
// precisely because you cannot atomically commit DB + Redis. jobId = outboxId
// guarantees BullMQ-side idempotency on retry-after-crash.
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

/** DI token for BullMQ ConnectionOptions. */
export const BULLMQ_CONNECTION = 'BULLMQ_CONNECTION' as const;
import { Queue, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import { routeOutboxRow, type OutboxTargetQueue } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { outbox } from '../database/schema/index.js';

const POLL_BATCH_SIZE = 50;
const MAX_ATTEMPTS_BEFORE_DEAD_LETTER = 5;

/**
 * Minimum wire shape every outbox row payload must satisfy. Routing policy
 * reads aggregateType + eventType; the rest is opaque to the relay.
 */
export const OutboxPayloadSchema = z.object({
  aggregateType: z.string().min(1).max(64),
  eventType: z.string().min(1).max(128),
}).passthrough();

export interface OutboxRelayResult {
  readonly polled: number;
  readonly enqueued: number;
  readonly deadLettered: number;
  readonly retryScheduled: number;
}

type ClaimedRow = {
  readonly outbox_id: string;
  readonly queue_name: string;
  readonly status: string;
  readonly attempts: number;
  readonly next_attempt_at: Date | null;
  readonly payload: unknown;
} & Record<string, unknown>;

@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly queues = new Map<OutboxTargetQueue, Queue>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(BULLMQ_CONNECTION) private readonly connection: ConnectionOptions,
  ) {}

  private getQueue(name: OutboxTargetQueue): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async drainOnce(): Promise<OutboxRelayResult> {
    // Claim a batch atomically. SKIP LOCKED ensures concurrent drainOnce calls
    // (or future multi-instance API deploys) never select the same row.
    const claimResult = await this.db.execute<ClaimedRow>(sql`
      SELECT outbox_id, queue_name, status, attempts, next_attempt_at, payload
      FROM ${outbox}
      WHERE (status = 'pending'
             OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()))
      ORDER BY created_at ASC
      LIMIT ${POLL_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `);
    const rows: readonly ClaimedRow[] = claimResult.rows;

    let enqueued = 0;
    let deadLettered = 0;
    let retryScheduled = 0;

    for (const row of rows) {
      const parsed = OutboxPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        await this.db
          .update(outbox)
          .set({ status: 'dead_letter', attempts: row.attempts + 1 })
          .where(eq(outbox.outboxId, row.outbox_id));
        this.logger.warn(`Dead-lettered outbox ${row.outbox_id}: invalid_payload (${parsed.error.issues[0]?.message ?? 'unknown'})`);
        deadLettered++;
        continue;
      }

      const decision = routeOutboxRow({
        aggregateType: parsed.data.aggregateType,
        eventType: parsed.data.eventType,
      });

      if (!decision.accepted) {
        await this.db
          .update(outbox)
          .set({ status: 'dead_letter', attempts: row.attempts + 1 })
          .where(eq(outbox.outboxId, row.outbox_id));
        this.logger.warn(`Dead-lettered outbox ${row.outbox_id}: ${decision.rejectionCode} (policy=${decision.policyVersion})`);
        deadLettered++;
        continue;
      }

      try {
        const q = this.getQueue(decision.queueName);
        await q.add(parsed.data.eventType, row.payload, {
          jobId: row.outbox_id,
          removeOnComplete: { age: 3600 },
          removeOnFail: false,
        });
        await this.db
          .update(outbox)
          .set({ status: 'sent', attempts: row.attempts + 1 })
          .where(eq(outbox.outboxId, row.outbox_id));
        enqueued++;
      } catch (err: unknown) {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS_BEFORE_DEAD_LETTER) {
          await this.db
            .update(outbox)
            .set({ status: 'dead_letter', attempts: nextAttempts })
            .where(eq(outbox.outboxId, row.outbox_id));
          deadLettered++;
        } else {
          // Match worker's outbox-policy.ts: retry rows are 'failed' + nextAttemptAt.
          // isEligibleForPickup() picks them up again when nextAttemptAt <= now.
          const backoffMs = 1000 * 2 ** nextAttempts;
          await this.db
            .update(outbox)
            .set({ status: 'failed', attempts: nextAttempts, nextAttemptAt: new Date(Date.now() + backoffMs) })
            .where(eq(outbox.outboxId, row.outbox_id));
          retryScheduled++;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to enqueue outbox ${row.outbox_id}: ${message}`);
      }
    }

    return { polled: rows.length, enqueued, deadLettered, retryScheduled };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
