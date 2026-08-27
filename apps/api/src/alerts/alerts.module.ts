// apps/api/src/alerts/alerts.module.ts
// T12 driver-order-alerts S3: wires the api-hosted alerts-queue consumer.
// ALERTS_WORKER_FACTORY binds the real BullMQ Worker factory to the
// OutboxModule-EXPORTED BULLMQ_CONNECTION (one Redis config owner; a second
// provider definition here would be the DI-config analog of an Axis-2
// duplication). PushModule supplies PUSH_PROVIDER (ExpoPushProvider) for
// device-token resolution + send. Tests bypass this module entirely and bind
// a fake factory (see alerts-consumer.service.test.ts).
import { Module, type Provider } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import { OutboxModule } from '../outbox/outbox.module.js';
import { BULLMQ_CONNECTION } from '../outbox/outbox-relay.service.js';
import { PushModule } from '../push/push.module.js';
import {
  AlertsConsumerService,
  ALERTS_WORKER_FACTORY,
  defaultAlertsWorkerFactory,
  type AlertsWorkerFactory,
} from './alerts-consumer.service.js';

const alertsWorkerFactoryProvider: Provider = {
  provide: ALERTS_WORKER_FACTORY,
  inject: [BULLMQ_CONNECTION],
  useFactory: (connection: ConnectionOptions): AlertsWorkerFactory =>
    defaultAlertsWorkerFactory(connection),
};

@Module({
  imports: [OutboxModule, PushModule],
  providers: [alertsWorkerFactoryProvider, AlertsConsumerService],
  exports: [AlertsConsumerService],
})
export class AlertsModule {}
