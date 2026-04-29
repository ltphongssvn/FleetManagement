// workers/main-worker/src/main.ts
// Worker bootstrap entrypoint. Wires BullMQ Workers to Redis per QUEUE_NAMES.
//
// Connection strategy: pass connection OPTIONS (not a shared instance) to each
// Worker. BullMQ uses blocking Redis commands (BLPOP); sharing one ioredis
// instance across multiple Workers causes connection starvation. Letting BullMQ
// manage isolated connections per Worker is the documented best practice.
//
// Routing: queue-router.ts dispatches per-queue (zod schema -> pure processor).
// Non-retryable boundary failures (ZodError) are routed to outbox-dead-letter
// per Frozen Stack PDF "outbox_dead_letter with max-retry + alert + manual
// requeue". Infra errors are rethrown so BullMQ applies retry/backoff.
import { Worker, Queue, type ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './queues.js';
import { loadConfig } from './config.js';
import { routeJob, createBullDeadLetterSink } from './queue-router.js';

function bootstrap(): void {
  const config = loadConfig();
  const connection: ConnectionOptions = {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };

  const deadLetterQueue = new Queue('outbox-dead-letter', { connection });
  const deadLetters = createBullDeadLetterSink(deadLetterQueue);

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker(
      name,
      async (job) => {
        const result = await routeJob(name, job, deadLetters);
        console.log(`[${name}] job ${String(job.id)} ${result.summary}`);
        return { processed: true, deadLettered: result.deadLettered };
      },
      { connection, concurrency: QUEUE_CONCURRENCY[name] },
    );

    worker.on('failed', (job, err) => {
      console.error(`[${name}] job ${String(job?.id)} failed:`, err.message);
    });
    worker.on('error', (err) => {
      console.error(`[${name}] worker error:`, err.message);
    });

    return worker;
  });

  console.log(`Started ${String(workers.length)} workers: ${QUEUE_NAMES.join(', ')}`);

  const shutdown = async (): Promise<void> => {
    await Promise.all(workers.map((w) => w.close()));
    await deadLetterQueue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

try {
  bootstrap();
} catch (err: unknown) {
  console.error('Worker bootstrap failed', err);
  process.exit(1);
}
