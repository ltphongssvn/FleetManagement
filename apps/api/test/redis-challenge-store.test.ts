// apps/api/test/redis-challenge-store.test.ts
// Outside-in RED: RedisChallengeStore replaces InMemoryChallengeStore (auth.module.ts:46,
// flagged "Production should use Redis with TTL"). The in-memory map breaks across
// replicas and loses challenges on restart. Contract: implements the ChallengeStore
// port (put/take), single-use (take consumes -> no replay), TTL expiry, and a
// schema-first Zod ChallengeRecord boundary. Uses ioredis-mock so two store
// instances sharing ONE client model the multi-replica case. Imports a module that
// does not exist yet -> MUST fail at import.
import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisChallengeStore, CHALLENGE_KEY_PREFIX } from '../src/auth/redis-challenge-store.js';

const TTL = 60;

describe('RedisChallengeStore', () => {
  let redis: InstanceType<typeof RedisMock>;
  beforeEach(() => {
    redis = new RedisMock();
  });

  it('put then take returns the stored challenge', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    await store.put('drv-1', 'chal-abc');
    expect(await store.take('drv-1')).toBe('chal-abc');
  });

  it('is readable across replicas sharing one Redis (the in-memory map fails here)', async () => {
    const replicaA = new RedisChallengeStore(redis as never, TTL);
    const replicaB = new RedisChallengeStore(redis as never, TTL);
    await replicaA.put('drv-2', 'chal-xyz');
    expect(await replicaB.take('drv-2')).toBe('chal-xyz'); // written on A, consumed on B
  });

  it('is single-use: a second take returns null (no replay)', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    await store.put('drv-3', 'chal-once');
    expect(await store.take('drv-3')).toBe('chal-once');
    expect(await store.take('drv-3')).toBeNull();
  });

  it('returns null for an unknown key', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    expect(await store.take('missing')).toBeNull();
  });

  it('expires after the TTL window', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    await store.put('drv-4', 'chal-exp');
    await redis.pexpire(CHALLENGE_KEY_PREFIX + 'drv-4', 0); // force deterministic expiry
    expect(await store.take('drv-4')).toBeNull();
  });

  it('sets a positive TTL on the key (no eternal challenges)', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    await store.put('drv-5', 'chal-ttl');
    const pttl = await redis.pttl(CHALLENGE_KEY_PREFIX + 'drv-5');
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL * 1000);
  });

  it('rejects a malformed record at the Zod boundary (empty challenge)', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    await expect(store.put('drv-6', '')).rejects.toThrow();
  });

  it('take returns null when the stored value is corrupt JSON / fails the schema (defense for legacy or tampered keys)', async () => {
    const store = new RedisChallengeStore(redis as never, TTL);
    // Write a value that bypasses put()'s Zod validation: not the {challenge} shape.
    await redis.set(CHALLENGE_KEY_PREFIX + 'drv-corrupt', JSON.stringify({ not: 'a-challenge' }));
    expect(await store.take('drv-corrupt')).toBeNull();
    // And a non-JSON payload must also be swallowed, not thrown.
    await redis.set(CHALLENGE_KEY_PREFIX + 'drv-garbage', 'not-json-at-all');
    expect(await store.take('drv-garbage')).toBeNull();
  });
});
