// workers/main-worker/src/queue-router.ts
// Routes a BullMQ job to its per-queue zod schema + pure processor.
// Distinguishes non-retryable boundary failures (ZodError -> dead letter) from
// retryable infra failures (Redis timeout, etc. -> BullMQ default retry).
//
// Frozen Stack PDF: "outbox_dead_letter with max-retry + alert + manual requeue".
// A malformed payload will never become valid through retry, so we route
// ZodError to the outbox-dead-letter queue immediately and return a structured
// rejection result so the BullMQ Worker doesn't keep retrying poison messages.
import type { Job, Queue } from 'bullmq';
import { ZodError } from 'zod';
import type { QueueName } from './queues.js';
import { IntakeJobDataSchema } from './intake/intake-job.js';
import { IntakeProcessor } from './intake/intake-processor.js';
import { ErpJobDataSchema } from './erp/erp-job.js';
import { ErpProcessor } from './erp/erp-processor.js';

export interface RouterResult {
  readonly handled: boolean;
  readonly summary: string;
  readonly deadLettered: boolean;
}

export interface DeadLetterEntry {
  readonly originalQueue: QueueName;
  readonly jobId: string | null;
  readonly reason: 'schema_validation_failed';
  readonly errorIssues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  readonly originalPayload: unknown;
  readonly receivedAt: string;
}

export interface DeadLetterSink {
  readonly send: (entry: DeadLetterEntry) => Promise<void>;
}

/** Adapter that publishes dead-letter entries to the outbox-dead-letter BullMQ queue. */
export function createBullDeadLetterSink(queue: Pick<Queue, 'add'>): DeadLetterSink {
  return {
    async send(entry: DeadLetterEntry): Promise<void> {
      await queue.add('schema_validation_failed', entry, { removeOnComplete: false, removeOnFail: false });
    },
  };
}

export async function routeJob(
  name: QueueName,
  job: Pick<Job<unknown>, 'id' | 'data'>,
  deadLetters: DeadLetterSink,
): Promise<RouterResult> {
  try {
    if (name === 'intake') {
      const data = IntakeJobDataSchema.parse(job.data);
      const decision = new IntakeProcessor().process(data);
      const summary = decision.accepted
        ? `accepted policy=${decision.policyVersion}`
        : `rejected:${decision.rejectionCode} policy=${decision.policyVersion}`;
      return { handled: true, summary, deadLettered: false };
    }
    if (name === 'erp') {
      const data = ErpJobDataSchema.parse(job.data);
      const decision = new ErpProcessor().process(data);
      const summary = decision.accepted
        ? `accepted policy=${decision.policyVersion}`
        : `rejected:${decision.rejectionCode} policy=${decision.policyVersion}`;
      return { handled: true, summary, deadLettered: false };
    }
    return { handled: false, summary: 'stub', deadLettered: false };
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      await deadLetters.send({
        originalQueue: name,
        jobId: job.id ?? null,
        reason: 'schema_validation_failed',
        errorIssues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        originalPayload: job.data,
        receivedAt: new Date().toISOString(),
      });
      return { handled: true, summary: 'dead_letter:schema_validation_failed', deadLettered: true };
    }
    throw err;
  }
}
