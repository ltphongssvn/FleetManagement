// apps/api/src/eas-inbound/eas-build-dedup.store.ts
// Idempotency store for the EAS BUILD webhook. EAS delivers at-least-once and
// RETRIES on any non-2xx/3xx (or a slow response), so the same build id can
// arrive more than once -- without dedup an errored build would fire DUPLICATE
// Sentry fatals. markSeen(buildId) records the id atomically with SET NX PX
// (set-if-absent + TTL in one round trip, no read-then-write race, mirrors the
// GETDEL single-use pattern in redis-challenge-store.ts) and returns true only
// on the FIRST delivery; repeats return false so the caller skips re-alerting.
// TTL must OUTLIVE the provider retry window (EAS retries ~24h) so a late retry
// still dedups; a lazy ioredis client (REDIS_URL) keeps module-boot connection-
// free. Schema-first: the stored marker passes a Zod contract on write.
import type { Redis } from 'ioredis';
import { z } from 'zod';

export const EAS_BUILD_SEEN_PREFIX = 'eas:build:seen:';

// SSOT for the marker value: the terminal status we alerted on (audit trail if
// the key is ever inspected). Value shape is validated on write.
export const EasBuildSeenRecordSchema = z.object({
  status: z.string().min(1),
  seenAt: z.string().min(1),
});
export type EasBuildSeenRecord = z.infer<typeof EasBuildSeenRecordSchema>;

// DI token (NestJS): the module binds this to an EasBuildDedupStore built
// from a lazy ioredis client (REDIS_URL). Mirrors auth.module CHALLENGE_STORE.
export const EAS_BUILD_DEDUP = Symbol('EAS_BUILD_DEDUP');

export interface EasBuildDedupPort {
  // true = first time this buildId is seen (caller SHOULD process);
  // false = already seen within the TTL window (caller SKIPS re-processing).
  markSeen(buildId: string, status: string): Promise<boolean>;
}

export class EasBuildDedupStore implements EasBuildDedupPort {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private redisKey(buildId: string): string {
    return EAS_BUILD_SEEN_PREFIX + buildId;
  }

  async markSeen(buildId: string, status: string): Promise<boolean> {
    const record = EasBuildSeenRecordSchema.parse({
      status,
      seenAt: new Date().toISOString(),
    });
    // SET key value NX PX ttl -> returns 'OK' if the key did NOT exist (we won
    // the race, first delivery), null if it already existed (a retry/duplicate).
    const res = await this.redis.set(
      this.redisKey(buildId),
      JSON.stringify(record),
      'PX',
      this.ttlSeconds * 1000,
      'NX',
    );
    return res === 'OK';
  }
}
