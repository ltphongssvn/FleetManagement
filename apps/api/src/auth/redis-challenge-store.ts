// apps/api/src/auth/redis-challenge-store.ts
// Redis-backed WebAuthn challenge store — replaces the in-process InMemoryChallengeStore
// (auth.module.ts), which breaks across replicas and loses challenges on restart.
// Implements the ChallengeStore port (put/take) used by passkey registration +
// authentication. Single-use is enforced atomically with GETDEL (read-and-delete in
// one round trip, no read-then-delete replay window). TTL bounds challenge lifetime
// so abandoned ceremonies cannot be replayed later. Schema-first: every stored value
// passes the ChallengeRecord Zod contract on write and is re-validated on read.
import type { Redis } from 'ioredis';
import { z } from 'zod';

export const CHALLENGE_KEY_PREFIX = 'webauthn:challenge:';

// SSOT for what a challenge value may be: a non-empty base64url-ish string.
export const ChallengeRecordSchema = z.object({
  challenge: z.string().min(1),
});
export type ChallengeRecord = z.infer<typeof ChallengeRecordSchema>;

export interface ChallengeStorePort {
  put(key: string, challenge: string): Promise<void>;
  take(key: string): Promise<string | null>;
}

export class RedisChallengeStore implements ChallengeStorePort {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private redisKey(key: string): string {
    return CHALLENGE_KEY_PREFIX + key;
  }

  async put(key: string, challenge: string): Promise<void> {
    const record = ChallengeRecordSchema.parse({ challenge });
    await this.redis.set(this.redisKey(key), JSON.stringify(record), 'PX', this.ttlSeconds * 1000);
  }

  async take(key: string): Promise<string | null> {
    // GETDEL: atomic read-and-delete -> single-use, no cross-replica replay window.
    const raw = await this.redis.getdel(this.redisKey(key));
    if (raw === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return null; // corrupt / non-JSON value (legacy or tampered key): fail safe
    }
    const parsed = ChallengeRecordSchema.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data.challenge;
  }
}
