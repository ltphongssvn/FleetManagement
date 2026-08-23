// apps/api/test/eas-build-dedup.store.test.ts
// Unit tests for EasBuildDedupStore -- the idempotency store behind the EAS
// BUILD webhook. Verifies the SET NX PX contract against a fake ioredis: first
// markSeen wins (returns true), a repeat within TTL returns false, the key
// carries the alerted status + an ISO seenAt (audit value), and NX/PX flags are
// passed so a real Redis enforces first-write-wins + expiry.
import { describe, it, expect } from 'vitest';
import {
  EasBuildDedupStore,
  EasBuildSeenRecordSchema,
  EAS_BUILD_SEEN_PREFIX,
} from '../src/eas-inbound/eas-build-dedup.store.js';

interface SetCall {
  key: string;
  value: string;
  args: unknown[];
}
// Minimal fake ioredis: models SET ... NX (first write wins) and records the
// full arg list so the PX/NX flags can be asserted.
function makeFakeRedis(): {
  set: (...a: unknown[]) => Promise<string | null>;
  calls: SetCall[];
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const calls: SetCall[] = [];
  return {
    calls,
    store,
    set: (...a: unknown[]): Promise<string | null> => {
      const [key, value, ...args] = a as [string, string, ...unknown[]];
      calls.push({ key, value, args });
      const hasNx = args.includes('NX');
      if (hasNx && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    },
  };
}

describe('@fleet/api - EasBuildDedupStore', () => {
  it('first markSeen returns true and writes a prefixed key', async () => {
    const redis = makeFakeRedis();
    const store = new EasBuildDedupStore(redis as never, 86_400);
    const fresh = await store.markSeen('build-1', 'errored');
    expect(fresh).toBe(true);
    expect(redis.calls[0]?.key).toBe(EAS_BUILD_SEEN_PREFIX + 'build-1');
  });

  it('a repeated id within TTL returns false (dedup)', async () => {
    const redis = makeFakeRedis();
    const store = new EasBuildDedupStore(redis as never, 86_400);
    await store.markSeen('build-1', 'errored');
    const again = await store.markSeen('build-1', 'errored');
    expect(again).toBe(false);
  });

  it('distinct ids are independent', async () => {
    const redis = makeFakeRedis();
    const store = new EasBuildDedupStore(redis as never, 86_400);
    expect(await store.markSeen('a', 'finished')).toBe(true);
    expect(await store.markSeen('b', 'finished')).toBe(true);
  });

  it('passes NX and PX flags so Redis enforces first-write-wins + expiry', async () => {
    const redis = makeFakeRedis();
    const store = new EasBuildDedupStore(redis as never, 120);
    await store.markSeen('build-x', 'canceled');
    const args = redis.calls[0]?.args ?? [];
    expect(args).toContain('NX');
    expect(args).toContain('PX');
    expect(args).toContain(120 * 1000);
  });

  it('the stored value satisfies the Zod record (status + ISO seenAt)', async () => {
    const redis = makeFakeRedis();
    const store = new EasBuildDedupStore(redis as never, 86_400);
    await store.markSeen('build-1', 'errored');
    const stored = redis.store.get(EAS_BUILD_SEEN_PREFIX + 'build-1');
    if (stored === undefined) throw new Error('expected a stored value');
    const parsed = EasBuildSeenRecordSchema.parse(JSON.parse(stored));
    expect(parsed.status).toBe('errored');
    expect(() => new Date(parsed.seenAt).toISOString()).not.toThrow();
    expect(new Date(parsed.seenAt).toISOString()).toBe(parsed.seenAt);
  });
});
