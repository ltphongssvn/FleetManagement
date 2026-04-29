// apps/api/src/outbox/outbox.module.ts
import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import { DatabaseModule } from '../database/database.module.js';
import { OutboxRelayService, BULLMQ_CONNECTION } from './outbox-relay.service.js';

const bullmqConnectionProvider: Provider = {
  provide: BULLMQ_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ConnectionOptions => ({
    url: config.getOrThrow<string>('REDIS_URL'),
    maxRetriesPerRequest: null,
  }),
};

@Module({
  imports: [DatabaseModule],
  providers: [bullmqConnectionProvider, OutboxRelayService],
  exports: [OutboxRelayService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OutboxModule {}
