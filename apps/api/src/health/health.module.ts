// apps/api/src/health/health.module.ts
// Binds the health surface, including the WORKER provenance reader.
//
// The reader is a one-method port over a lazy ioredis client, mirroring
// auth.module CHALLENGE_STORE and eas-inbound EAS_BUILD_DEDUP: lazyConnect
// means no socket opens at module boot, so DI resolves in tests and in
// environments without a live Redis; the connection opens on the first read.
//
// REDIS_URL comes from ConfigService -- the value EnvSchema already validated
// with z.url() and already defaulted. getOrThrow (not get) keeps it fail-closed:
// a missing key is a boot error, never a silent fallback to localhost. The
// no-restricted-syntax rule scoped to *.module.ts enforces this repo-wide.
//
// The key and its TTL are owned by the worker
// (workers/main-worker/src/boot-provenance.ts) and imported here, so writer and
// reader can never disagree about which key holds the heartbeat.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { WORKER_PROVENANCE_KEY } from '@fleet/sync-protocol';
import { HealthController } from './health.controller.js';
import { WORKER_PROVENANCE_READER } from './worker-provenance.token.js';
import type { WorkerProvenanceReader } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: WORKER_PROVENANCE_READER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): WorkerProvenanceReader => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
        return () => redis.get(WORKER_PROVENANCE_KEY);
      },
    },
  ],
})

export class HealthModule {}
