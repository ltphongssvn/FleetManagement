// workers/main-worker/src/main.ts
// Worker bootstrap entrypoint. Wires BullMQ Workers to Redis per QUEUE_NAMES.
//
// Connection strategy: pass connection OPTIONS (not a shared instance) to each
// Worker. BullMQ uses blocking Redis commands (BLPOP); sharing one ioredis
// instance across multiple Workers causes connection starvation. Letting BullMQ
// manage isolated connections per Worker is the documented best practice.
//
// Error handling: every Worker has 'failed' and 'error' listeners. Without them,
// failures are silently swallowed and Redis disconnects crash the process.
//
// Real processors arrive in week 3+ per day-one plan (outbox + projections + erp first).
import { Worker, type ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './queues.js';
import { loadConfig } from './config.js';

function bootstrap(): void {
  const config = loadConfig();
  const connection: ConnectionOptions = {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker(
      name,
      async (job) => {
        // Stub: real processors land in week 3+. Logging only for now.
        if (name === 'intake') {
            const { IntakeJobDataSchema } = await import('./intake/intake-job.js');
            const { IntakeProcessor } = await import('./intake/intake-processor.js');
            const data = IntakeJobDataSchema.parse(job.data);
            const decision = new IntakeProcessor().process(data);
            console.log(`[intake] job ${String(job.id)} decision=${decision.accepted ? 'accepted' : 'rejected:' + (decision as { rejectionCode: string }).rejectionCode} policy=${decision.policyVersion}`);
            return decision;
          }
          console.log(`[${name}] processing job ${String(job.id)}`);
        return Promise.resolve({ processed: true });
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
