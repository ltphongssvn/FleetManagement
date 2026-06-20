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
    // Claim a batch INSIDE A TRANSACTION. FOR UPDATE SKIP LOCKED only serializes
    // concurrent claimers while the row lock is HELD, and a row lock is held only
    // for the life of the surrounding transaction. Running the SELECT via a bare
    // db.execute() (autocommit) released the lock the instant the SELECT
    // returned, so two overlapping drainOnce calls (or multi-instance deploys)
    // both saw the same 'pending' row and double-enqueued. We therefore wrap the
    // claim in db.transaction(): the SELECT ... FOR UPDATE SKIP LOCKED and the
    // immediate flip of those rows to 'sent' happen atomically with the lock
    // held, so no other claimer can grab them. We mark 'sent' optimistically at
    // claim time (not after the broker confirms) on purpose: the outbox cannot
    // atomically commit Postgres + Redis, and BullMQ jobId = outboxId already
    // makes the enqueue idempotent on retry-after-crash. The publish then happens
    // OUTSIDE the tx (the long-standing "never wrap BullMQ in a Postgres tx"
    // invariant); if it fails, the catch below reschedules the row as
    // 'failed'/'dead_letter'. (Trade-off per the outbox literature: at-least-once
    // with rare duplicates is preferred over losing events; consumers are
    // idempotent.) Dead-letter for invalid payload / unroutable rows still runs
    // post-claim and overwrites the optimistic 'sent'.
    const rows: readonly ClaimedRow[] = await this.db.transaction(async (tx) => {
      const claimResult = await tx.execute<ClaimedRow>(sql`
        SELECT outbox_id, queue_name, status, attempts, next_attempt_at, payload
        FROM ${outbox}
        WHERE (status = 'pending'
               OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()))
        ORDER BY created_at ASC
        LIMIT ${POLL_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);
      const claimed: readonly ClaimedRow[] = claimResult.rows;
      if (claimed.length > 0) {
        // Flip the claimed rows to 'sent' WHILE the lock is held, so a competing
        // claimer cannot also select them once this tx commits.
        await tx.execute(sql`
          UPDATE ${outbox}
          SET status = 'sent', attempts = attempts + 1
          WHERE outbox_id IN (${sql.join(claimed.map((r) => sql`${r.outbox_id}`), sql`, `)})
        `);
      }
      return claimed;
    });

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
        /* c8 ignore next -- ?? 'unknown' fallback unreachable: zod always populates issues on failure */
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
        // Head-body split: the outbox payload is an envelope
        // ({aggregateType, eventType, serverSeq}) wrapping the job BODY. Routing
        // above reads the envelope; the consumer strict-parses only the BODY, so
        // we strip the envelope fields before enqueueing. (Without this the
        // consumer dead-letters with schema_validation_failed on the extra keys.)
        const envelope = (row.payload ?? {}) as Record<string, unknown>;
        const { aggregateType: _at, eventType: _et, serverSeq: _ss, ...body } = envelope;
        await q.add(parsed.data.eventType, body, {
          jobId: row.outbox_id,
          removeOnComplete: { age: 3600 },
          removeOnFail: false,
        });
        // Row was already marked 'sent' (attempts incremented) atomically at
        // claim time inside the transaction above, so no status update is needed
        // here on the happy path -- we just count the successful enqueue.
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
