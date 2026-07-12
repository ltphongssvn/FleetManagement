// apps/api/test/alerts-consumer.service.test.ts
// S3 RED (T12 driver-order-alerts): api-hosted BullMQ consumer of the alerts
// queue. Contract: strict-parse the job body as DriverAlertJob at the queue
// trust boundary; poison (schema) failures throw UnrecoverableError so BullMQ
// never retries them; a deliverability zero (accepted === 0) throws LOUDLY so
// the job lands in failed (removeOnFail: false upstream) where the alert-lag
// monitor can see it -- a silently swallowed 4AM alert is the incident class
// this arc exists to kill. Worker construction goes through a DI factory seam
// (house EXPO_CLIENT pattern) so tests capture the processor without Redis.
// Vietnamese strings are PRESENTATION, composed here (server-side), and are
// immutable production contract values once shipped:
//   title: 'L\u1ec7nh \u0111i\u1ec1u xe m\u1edbi'
//   body:  'B\u1ea1n c\u00f3 l\u1ec7nh \u0111i\u1ec1u xe m\u1edbi: ' + externalRef
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import {
  AlertsConsumerService,
  DRIVER_ALERT_TITLE_VI,
  driverAlertBodyVi,
  type AlertsWorkerFactory,
  type AlertsJobProcessor,
  type WorkerLike,
} from '../src/alerts/alerts-consumer.service.js';
import type { IPushProvider, PushSendResult } from '../src/push/push-provider.interface.js';

const OPERATOR_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const ROAD_RUN_ID = '018f6b2a-9c1d-4e5f-8a7b-2c3d4e5f6a7b';
const VALID_JOB = {
  alertKind: 'transport_order_created',
  assignedOperatorId: OPERATOR_ID,
  roadRunId: ROAD_RUN_ID,
  externalRef: 'XTT.07-001',
} as const;

interface Captured {
  queueName: string | null;
  processor: AlertsJobProcessor | null;
  worker: { close: ReturnType<typeof vi.fn> };
}

function makeSeams(sendResult: PushSendResult): {
  captured: Captured;
  factory: AlertsWorkerFactory;
  push: IPushProvider & { sendToOperator: ReturnType<typeof vi.fn> };
} {
  const captured: Captured = {
    queueName: null,
    processor: null,
    worker: { close: vi.fn().mockResolvedValue(undefined) },
  };
  const factory: AlertsWorkerFactory = (queueName, processor): WorkerLike => {
    captured.queueName = queueName;
    captured.processor = processor;
    return captured.worker as unknown as WorkerLike;
  };
  const push = { sendToOperator: vi.fn().mockResolvedValue(sendResult) };
  return { captured, factory, push };
}

describe('@fleet/api - AlertsConsumerService', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts one worker on the alerts queue at module init', () => {
    const { captured, factory, push } = makeSeams({ accepted: 1, rejected: 0 });
    const svc = new AlertsConsumerService(factory, push);
    svc.onModuleInit();
    expect(captured.queueName).toBe('alerts');
    expect(captured.processor).not.toBeNull();
  });

  it('valid job: strict-parses body and pushes Vietnamese title/body + push-data payload (no operator id on the wire)', async () => {
    const { captured, factory, push } = makeSeams({ accepted: 1, rejected: 0 });
    const svc = new AlertsConsumerService(factory, push);
    svc.onModuleInit();
    if (captured.processor === null) throw new Error('processor not captured');
    await captured.processor({ id: 'ob-1', data: VALID_JOB });
    expect(push.sendToOperator).toHaveBeenCalledTimes(1);
    const call = push.sendToOperator.mock.calls[0] as unknown[];
    expect(call[0]).toBe(OPERATOR_ID);
    const body = call[1] as { title: string; body: string; data?: Record<string, unknown> };
    expect(body.title).toBe(DRIVER_ALERT_TITLE_VI);
    expect(body.body).toBe(driverAlertBodyVi('XTT.07-001'));
    expect(body.data).toEqual({
      alertKind: 'transport_order_created',
      roadRunId: ROAD_RUN_ID,
      externalRef: 'XTT.07-001',
    });
  });

  it('poison body (outbox envelope leak) throws UnrecoverableError and never calls push', async () => {
    const { captured, factory, push } = makeSeams({ accepted: 1, rejected: 0 });
    const svc = new AlertsConsumerService(factory, push);
    svc.onModuleInit();
    if (captured.processor === null) throw new Error('processor not captured');
    const poisoned = { ...VALID_JOB, aggregateType: 'driver_alert' };
    await expect(captured.processor({ id: 'ob-2', data: poisoned })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(push.sendToOperator).not.toHaveBeenCalled();
  });

  it('accepted === 0 (no deliverable device token) throws so the job lands in failed for the monitor', async () => {
    const { captured, factory, push } = makeSeams({ accepted: 0, rejected: 1 });
    const svc = new AlertsConsumerService(factory, push);
    svc.onModuleInit();
    if (captured.processor === null) throw new Error('processor not captured');
    await expect(captured.processor({ id: 'ob-3', data: VALID_JOB })).rejects.toThrow(/accepted 0/);
  });

  it('closes the worker on module destroy (idempotent when never started)', async () => {
    const { captured, factory, push } = makeSeams({ accepted: 1, rejected: 0 });
    const svc = new AlertsConsumerService(factory, push);
    await svc.onModuleDestroy();
    svc.onModuleInit();
    await svc.onModuleDestroy();
    expect(captured.worker.close).toHaveBeenCalledTimes(1);
  });
});
