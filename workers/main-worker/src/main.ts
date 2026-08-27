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
import { KeycloakClientCredentialsTokenProvider } from './auth/keycloak-token-provider.js';
import { FetchErpClient } from './erp/fetch-erp-client.js';
import { S3IntakeObjectStore, type IntakeObjectStore } from './intake/intake-object-store.js';
import type { ErpClientPort } from './erp/erp-send-flow.js';
import {
  FetchExtractionCallback,
  type ExtractionCallback,
} from './extraction/extraction-callback.js';
import { S3ExtractionObjectStore } from './extraction/s3-extraction-object-store.js';
import { GeminiVlmExtractor } from './extraction/gemini-vlm-extractor.js';
import type { ExtractionObjectStore, VlmExtractorPort } from './extraction/extraction-flow.js';
import { logEvent } from './logger.js';
import {
  buildBootProvenance,
  bootProvenanceSetArgs,
  provenanceRefreshIntervalMs,
  startProvenanceRenewal,
} from './boot-provenance.js';

function bootstrap(): void {
  const config = loadConfig();
  const connection: ConnectionOptions = {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };

  const deadLetterQueue = new Queue('outbox-dead-letter', { connection });
  const deadLetters = createBullDeadLetterSink(deadLetterQueue);

  // Callbacks authenticate via OAuth2 client-credentials (RFC 6749 s4.4):
  // the provider mints short-lived tokens on demand (cached, single-flight,
  // 60s pre-expiry buffer) -- replacing the static FLEET_API_TOKEN whose
  // silent expiry stalled 65 manifests in verifying (Jun-24 incident).
  // Gating stays pilot-safe: any var absent -> callbacks skip.
  let tokenProvider: KeycloakClientCredentialsTokenProvider | undefined;
  if (
    config.WORKER_OIDC_TOKEN_URL &&
    config.WORKER_OIDC_CLIENT_ID &&
    config.WORKER_OIDC_CLIENT_SECRET
  ) {
    tokenProvider = new KeycloakClientCredentialsTokenProvider({
      tokenUrl: config.WORKER_OIDC_TOKEN_URL,
      clientId: config.WORKER_OIDC_CLIENT_ID,
      clientSecret: config.WORKER_OIDC_CLIENT_SECRET,
    });
  }
  let intakeCallback: IntakeCallback | undefined;
  if (config.FLEET_API_URL && tokenProvider) {
    const provider = tokenProvider;
    intakeCallback = new FetchIntakeCallback({
      apiUrl: config.FLEET_API_URL,
      bearerToken: () => provider.getToken(),
      onUnauthorized: () => {
        provider.invalidate();
      },
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

  // Extraction ports (phieu-can net weight): callback mirrors intake (same
  // FLEET_API_URL + OIDC client-credentials gating); store mirrors the intake S3 gating; the VLM
  // adapter only exists when GEMINI_API_KEY is set. Any port absent -> the
  // router completes jobs with a 'ports not configured' skip (pilot-safe).
  let extractionCallback: ExtractionCallback | undefined;
  if (config.FLEET_API_URL && tokenProvider) {
    const provider = tokenProvider;
    extractionCallback = new FetchExtractionCallback({
      apiUrl: config.FLEET_API_URL,
      bearerToken: () => provider.getToken(),
      onUnauthorized: () => {
        provider.invalidate();
      },
    });
  }
  let extractionStore: ExtractionObjectStore | undefined;
  if (config.AWS_REGION) {
    extractionStore = new S3ExtractionObjectStore({
      region: config.AWS_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    });
  }
  let vlmExtractor: VlmExtractorPort | undefined;
  if (config.GEMINI_API_KEY) {
    vlmExtractor = new GeminiVlmExtractor({
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
    });
  }

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker(
      name,
      async (job) => {
        const result = await routeJob(
          name,
          job,
          deadLetters,
          intakeCallback,
          erpClient,
          objectStore,
          extractionCallback,
          extractionStore,
          vlmExtractor,
        );
        logEvent('info', 'job processed', {
          queue: name,
          jobId: String(job.id),
          summary: result.summary,
        });
        return { processed: true, deadLettered: result.deadLettered };
      },
      { connection, concurrency: QUEUE_CONCURRENCY[name] },
    );

    worker.on('failed', (job, err) => {
      logEvent('error', 'job failed', { queue: name, jobId: String(job?.id), error: err.message });
    });
    worker.on('error', (err) => {
      logEvent('error', 'worker error', { queue: name, error: err.message });
    });

    return worker;
  });

  logEvent('info', 'workers started', { count: workers.length, queues: QUEUE_NAMES });

  // Record WHICH COMMIT is live, so the deploy can be verified. The worker has
  // no HTTP surface and no public domain, so CI cannot probe it; it writes a
  // TTL'd heartbeat to Redis instead and the api exposes it. Writing it proves
  // the process booted AND reached its dependencies -- stronger than a log line,
  // which proves only that a string was printed.
  //
  // Fire-and-forget by design: bootstrap() is synchronous, and provenance is a
  // REPORTING concern. A Redis hiccup must never stop the worker from consuming
  // jobs, so a failure is logged and swallowed -- the deploy check then sees an
  // absent key and fails closed, which is the correct signal.
  //
  // RENEWED, not written once. A single boot write with a TTL is a deploy-window
  // marker, not a heartbeat: the key expired 15 minutes after boot whether the
  // process was healthy or dead, so the reader was wrong in BOTH directions --
  // PRESENT for 15 minutes after a worker that died at minute one, ABSENT for a
  // worker that had been consuming jobs all day. Production proved it on
  // 2026-08-06: /health/worker-version answered 503 thirty-nine minutes after a
  // SUCCESSFUL worker deploy. Re-writing on an interval makes an absent key mean
  // what this comment has always claimed it means.
  const provenance = buildBootProvenance(process.env, () => new Date().toISOString());
  const writeProvenance = (first: boolean): void => {
    void deadLetterQueue.client
      .then((redis) => redis.set(...bootProvenanceSetArgs(provenance)))
      .then(() => {
        // Only the first write is announced. Logging every renewal would emit a
        // line every 5 minutes forever, drowning the signal this exists to give.
        if (first) {
          logEvent('info', 'boot provenance recorded', {
            sha: provenance.shortSha,
            branch: provenance.branch,
          });
        }
      })
      .catch((err: unknown) => {
        logEvent('error', 'boot provenance write failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };
  // The loop lives in boot-provenance.ts behind an injected write, so a fake
  // timer can prove the call ACTUALLY REPEATS -- and so the tested seam and the
  // shipped behaviour are the same code, not two implementations that agree
  // only by inspection. It also owns the unref() and the per-tick error
  // swallow: a throw inside a timer callback would otherwise end the heartbeat
  // after one Redis blip, which reads as a dead worker forever after.
  startProvenanceRenewal(writeProvenance, provenanceRefreshIntervalMs());

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
  logEvent('error', 'worker bootstrap failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}
