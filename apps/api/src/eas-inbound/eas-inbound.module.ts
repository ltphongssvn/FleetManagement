// apps/api/src/eas-inbound/eas-inbound.module.ts
// Wires the EAS BUILD webhook receiver + its idempotency store. EAS_BUILD_DEDUP
// is bound to an EasBuildDedupStore over a lazy ioredis client -- no connection
// at module boot (mirrors auth.module CHALLENGE_STORE), the socket opens on the
// first markSeen. TTL 24h > the EAS retry window so a late retry still dedups.
//
// REDIS_URL comes from ConfigService, i.e. the value EnvSchema already validated
// with z.url() and already defaulted. This previously read
//   process.env['REDIS_URL'] ?? 'redis://localhost:6379'
// which skipped that validation at a trust boundary and restated a default the
// schema owns -- so a malformed URL passed silently and a misconfigured
// production would quietly dial localhost instead of failing loudly.
// env.config.ts states the standard for this same feature's webhook secrets:
// declared at the validated boundary, not read raw. getOrThrow (not get) keeps
// it fail-closed: a missing key is a boot error, never a silent fallback.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { EasInboundController } from './eas-inbound.controller.js';
import { EAS_BUILD_DEDUP, EasBuildDedupStore } from './eas-build-dedup.store.js';
const EAS_BUILD_SEEN_TTL_SECONDS = 24 * 60 * 60;
@Module({
  controllers: [EasInboundController],
  providers: [
    {
      provide: EAS_BUILD_DEDUP,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EasBuildDedupStore => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const redis = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        });
        return new EasBuildDedupStore(redis, EAS_BUILD_SEEN_TTL_SECONDS);
      },
    },
  ],
})

export class EasInboundModule {}
