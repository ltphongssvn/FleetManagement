// apps/api/src/eas-inbound/eas-inbound.module.ts
// Wires the EAS BUILD webhook receiver + its idempotency store. EAS_BUILD_DEDUP
// is bound to an EasBuildDedupStore over a lazy ioredis client (REDIS_URL) --
// no connection at module boot (mirrors auth.module CHALLENGE_STORE), the
// socket opens on the first markSeen. TTL 24h > the EAS retry window so a late
// retry still dedups.
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EasInboundController } from './eas-inbound.controller.js';
import { EAS_BUILD_DEDUP, EasBuildDedupStore } from './eas-build-dedup.store.js';
const EAS_BUILD_SEEN_TTL_SECONDS = 24 * 60 * 60;
@Module({
  controllers: [EasInboundController],
  providers: [
    {
      provide: EAS_BUILD_DEDUP,
      useFactory: (): EasBuildDedupStore => {
        const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        });
        return new EasBuildDedupStore(redis, EAS_BUILD_SEEN_TTL_SECONDS);
      },
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class EasInboundModule {}
