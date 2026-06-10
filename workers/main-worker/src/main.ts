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
import { FetchIntakeCallback, type IntakeCallback } from './intake/intake-callback.js';
import { FetchErpClient } from './erp/fetch-erp-client.js';
import { S3IntakeObjectStore, type IntakeObjectStore } from './intake/intake-object-store.js';
import type { ErpClientPort } from './erp/erp-send-flow.js';

function bootstrap(): void {
  const config = loadConfig();
  const connection: ConnectionOptions = {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };

  const deadLetterQueue = new Queue('outbox-dead-letter', { connection });
  const deadLetters = createBullDeadLetterSink(deadLetterQueue);

  // Intake callback: only constructed if FLEET_API_URL + FLEET_API_TOKEN provided.
  // Pilot scope: token is a static service-account JWT loaded from env. Production
  // would mint a short-lived service-token via the IIdentityProvider seam.
  let intakeCallback: IntakeCallback | undefined;
  if (config.FLEET_API_URL && config.FLEET_API_TOKEN) {
    const apiUrl = config.FLEET_API_URL;
    const apiToken = config.FLEET_API_TOKEN;
    intakeCallback = new FetchIntakeCallback({
      apiUrl,
      bearerToken: () => apiToken,
    });
  }

  let erpClient: ErpClientPort | undefined;
  if (config.ERP_API_URL && config.ERP_API_KEY) {
    erpClient = new FetchErpClient({ baseUrl: config.ERP_API_URL, apiKey: config.ERP_API_KEY });
  }
  // S3 intake enrichment store: only constructed when AWS_REGION is set. Without
  // it, routeJob skips enrichment (actuals stay null -> object_missing), which is
  // the correct fail-closed signal that S3 is unconfigured.
  let objectStore: IntakeObjectStore | undefined;
  if (config.AWS_REGION) {
    objectStore = new S3IntakeObjectStore({
      region: config.AWS_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    });
  }

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker(
      name,
      async (job) => {
        const result = await routeJob(name, job, deadLetters, intakeCallback, erpClient, objectStore);
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
