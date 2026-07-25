// apps/api/src/alerts/alerts-consumer.service.ts
// T12 driver-order-alerts S3: api-hosted BullMQ consumer of the 'alerts'
// queue. HOST DECISION (evidence-driven): the api already owns all three
// capabilities this consumer needs -- DB-backed token lookup via
// ExpoPushProvider, the PUSH_PROVIDER port, and BULLMQ_CONNECTION -- while
// workers/main-worker is deliberately DB-less and reports back over
// FLEET_API_TOKEN callbacks, the exact static-credential surface whose decay
// caused the 17-day P4 intake stall. Hosting alert-send there would mint a
// second such surface for zero gain.
//
// Trust boundary: the job body is strict-parsed as DriverAlertJob (SSOT,
// @fleet/sync-protocol). Schema failures throw BullMQ UnrecoverableError --
// poison never becomes valid through retry (mirror of the worker router's
// ZodError -> dead-letter stance, expressed BullMQ-natively: the job goes
// straight to failed, retained by the relay's removeOnFail: false).
// Deliverability zero (accepted === 0: no registered device token, or Expo
// rejected every send) throws LOUDLY for the same reason -- a silently
// swallowed 4AM alert is the incident class this arc exists to kill; failed
// jobs are the alert-lag monitor's (S6) evidence trail.
//
// Vietnamese strings are PRESENTATION, composed server-side here, and are
// immutable production contract values once shipped. Delivery mechanics
// (channelId, priority, interruptionLevel, sound) are PROVIDER-owned (S4);
// this consumer owns only WHO (operator address) and WHAT (title/body/data).
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, UnrecoverableError, type ConnectionOptions } from 'bullmq';
import { DriverAlertJobSchema, OUTBOX_QUEUES, type DriverAlertPushData } from '@fleet/sync-protocol';
import { PUSH_PROVIDER, type IPushProvider } from '../push/push-provider.interface.js';

/** Immutable VI title for a new transport order alert. */
export const DRIVER_ALERT_TITLE_VI = 'Lệnh điều xe mới';
/** Immutable VI body: human order code is the one thing a 4AM driver reads. */
export function driverAlertBodyVi(externalRef: string): string {
  return 'Bạn có lệnh điều xe mới: ' + externalRef;
}

/** Subset of BullMQ Worker used here; lets tests inject a fake (EXPO_CLIENT pattern). */
export interface WorkerLike {
  close(): Promise<void>;
}
/** Processor contract the factory wires into the Worker. */
export type AlertsJobProcessor = (job: { readonly id?: string | null; readonly data: unknown }) => Promise<void>;
/** Factory seam: production builds a real BullMQ Worker; tests capture the processor. */
export type AlertsWorkerFactory = (queueName: string, processor: AlertsJobProcessor) => WorkerLike;
export const ALERTS_WORKER_FACTORY = 'ALERTS_WORKER_FACTORY' as const;

/** Normalize a raw BullMQ job into the processor contract shape. Extracted as a
 *  named, side-effect-free function so the id-nullish-coalescing branch is
 *  directly unit-testable without booting a real Worker (which needs Redis).
 *  Leaves new Worker(...) below as the only broker-coupled line. */
export function toProcessorJob(rawJob: { readonly id?: string | null; readonly data: unknown }): { readonly id: string | null; readonly data: unknown } {
  return { id: rawJob.id ?? null, data: rawJob.data };
}
/** Default factory: real BullMQ Worker on the shared connection options.
 *  concurrency 1: alert volume is one job per created order (pilot scale);
 *  ordered, simple, and the loud-failure semantics stay easy to reason about. */
/** The Worker processor-arrow body, extracted as a named async function so its
 *  delegation is directly unit-testable with a spy (the inline arrow is only
 *  ever invoked by a live BullMQ job event, which needs Redis). Normalizes the
 *  raw job then forwards to the injected processor. */
export async function runAlertsJob(
  processor: AlertsJobProcessor,
  rawJob: { readonly id?: string | null; readonly data: unknown },
): Promise<void> {
  await processor(toProcessorJob(rawJob));
}
/** Default factory: real BullMQ Worker on the shared connection options.
 *  concurrency 1: alert volume is one job per created order (pilot scale);
 *  ordered, simple, and the loud-failure semantics stay easy to reason about. */
export function defaultAlertsWorkerFactory(connection: ConnectionOptions): AlertsWorkerFactory {
  return (queueName, processor) =>
    new Worker(queueName, (job) => runAlertsJob(processor, job), { connection, concurrency: 1 });
}
/** Human-safe job label for error messages: a BullMQ job id, or 'unknown' when
 *  absent. Extracted so the id-nullish branch is covered in ONE place rather
 *  than duplicated across every throw site. */
export function jobLabel(id: string | null | undefined): string {
  return id ?? 'unknown';
}

@Injectable()
export class AlertsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsConsumerService.name);
  private worker: WorkerLike | null = null;

  constructor(
    @Inject(ALERTS_WORKER_FACTORY) private readonly workerFactory: AlertsWorkerFactory,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: IPushProvider,
  ) {}

  onModuleInit(): void {
    this.worker = this.workerFactory(OUTBOX_QUEUES.ALERTS, async (job) => { await this.process(job); });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker !== null) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: { readonly id?: string | null; readonly data: unknown }): Promise<void> {
    const parsed = DriverAlertJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Poison: retries cannot fix a schema failure. UnrecoverableError makes
      // BullMQ fail the job immediately (no backoff loop).
      throw new UnrecoverableError(
        'driver_alert job ' + jobLabel(job.id) + ' schema_validation_failed: '
        /* c8 ignore next -- a ZodError always carries >=1 issue; the ?? fallback is unreachable defensive code */
        + (parsed.error.issues[0]?.message ?? 'unknown'),
      );
    }
    // Axis-2 derivation, Axis-1 no-redundant-revalidation: the push-data wire
    // shape is the job minus the server-side address, already validated above;
    // the typed omit-spread carries the compile-time guarantee.
    const { assignedOperatorId, ...pushData } = parsed.data;
    const data: DriverAlertPushData = pushData;
    const result = await this.pushProvider.sendToOperator(assignedOperatorId, {
      title: DRIVER_ALERT_TITLE_VI,
      body: driverAlertBodyVi(parsed.data.externalRef),
      data,
    });
    if (result.accepted === 0) {
      throw new Error(
        'driver_alert job ' + jobLabel(job.id) + ' accepted 0 (rejected '
        + String(result.rejected) + ') for operator ' + assignedOperatorId,
      );
    }
    this.logger.log(
      'driver_alert delivered ' + parsed.data.externalRef + ' -> operator '
      + assignedOperatorId + ' (accepted ' + String(result.accepted) + ')',
    );
  }
}
