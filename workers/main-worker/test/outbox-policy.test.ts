// workers/main-worker/test/outbox-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  nextStatusAfterAttempt,
  isEligibleForPickup,
  DEFAULT_RETRY_POLICY,
  type OutboxRow,
  type AttemptDeps,
  type RetryPolicy,
} from '../src/outbox/outbox-policy.js';
function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    outboxId: 'o1',
    queueName: 'projections' as const,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    payload: {},
    ...overrides,
  };
}
const FROZEN_TIME = new Date('2026-04-27T18:00:00Z').getTime();
const deterministicDeps: AttemptDeps = { now: () => FROZEN_TIME, random: () => 0.5 };
describe('@fleet/main-worker - nextStatusAfterAttempt', () => {
  it('marks succeeded on success', () => {
    const r = nextStatusAfterAttempt(row(), 'success', DEFAULT_RETRY_POLICY, deterministicDeps);
    expect(r.status).toBe('succeeded');
    expect(r.nextAttempts).toBe(1);
    expect(r.nextAttemptAt).toBeNull();
    expect(r.policyVersion).toBe('outbox-retry-v1');
  });
  it('marks failed with deterministic nextAttemptAt (random=0.5 = midpoint = no jitter)', () => {
    const r = nextStatusAfterAttempt(row(), 'failure', DEFAULT_RETRY_POLICY, deterministicDeps);
    expect(r.nextAttempts).toBe(1);
    if (r.nextAttemptAt === null) throw new Error('expected nextAttemptAt');
    expect(r.nextAttemptAt.getTime()).toBe(FROZEN_TIME + 2000);
  });
  it('escalates to dead_letter at policy.maxAttempts', () => {
    const r = nextStatusAfterAttempt(
      row({ attempts: DEFAULT_RETRY_POLICY.maxAttempts - 1 }),
      'failure',
      DEFAULT_RETRY_POLICY,
      deterministicDeps,
    );
    expect(r.status).toBe('dead_letter');
    expect(r.nextAttemptAt).toBeNull();
  });
  it('respects per-queue policy override (maxAttempts=2)', () => {
    const fastFail: RetryPolicy = { maxAttempts: 2, baseSeconds: 1, jitterRatio: 0 };
    const r1 = nextStatusAfterAttempt(row({ attempts: 0 }), 'failure', fastFail, deterministicDeps);
    expect(r1.status).toBe('failed');
    const r2 = nextStatusAfterAttempt(row({ attempts: 1 }), 'failure', fastFail, deterministicDeps);
    expect(r2.status).toBe('dead_letter');
  });
  it('exact backoff with jitterRatio=0 (random ignored)', () => {
    const noJitter: RetryPolicy = { maxAttempts: 5, baseSeconds: 1, jitterRatio: 0 };
    const r = nextStatusAfterAttempt(row({ attempts: 2 }), 'failure', noJitter, deterministicDeps);
    if (r.nextAttemptAt === null) throw new Error('expected nextAttemptAt');
    expect(r.nextAttemptAt.getTime()).toBe(FROZEN_TIME + 8000);
  });
  it('jitter at random=0 produces minimum delay (-jitterRatio)', () => {
    const minRandom: AttemptDeps = { now: () => FROZEN_TIME, random: () => 0 };
    const r = nextStatusAfterAttempt(row(), 'failure', DEFAULT_RETRY_POLICY, minRandom);
    if (r.nextAttemptAt === null) throw new Error('expected nextAttemptAt');
    expect(r.nextAttemptAt.getTime()).toBe(FROZEN_TIME + 1500);
  });
  it('jitter at random=1 produces maximum delay (+jitterRatio)', () => {
    const maxRandom: AttemptDeps = { now: () => FROZEN_TIME, random: () => 1 };
    const r = nextStatusAfterAttempt(row(), 'failure', DEFAULT_RETRY_POLICY, maxRandom);
    if (r.nextAttemptAt === null) throw new Error('expected nextAttemptAt');
    expect(r.nextAttemptAt.getTime()).toBe(FROZEN_TIME + 2500);
  });
  it('uses real injected deps (Date.now/Math.random) when deps arg is omitted', () => {
    const before = Date.now();
    const r = nextStatusAfterAttempt(row({ attempts: 0 }), 'failure', DEFAULT_RETRY_POLICY);
    const after = Date.now();
    expect(r.status).toBe('failed');
    if (r.nextAttemptAt === null) throw new Error('expected nextAttemptAt');
    expect(r.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 1500);
    expect(r.nextAttemptAt.getTime()).toBeLessThanOrEqual(after + 2500);
  });
});
describe('@fleet/main-worker - isEligibleForPickup', () => {
  const now = new Date('2026-04-27T18:00:00Z');
  it('picks up pending immediately', () => {
    expect(isEligibleForPickup(row({ status: 'pending' }), now)).toBe(true);
  });
  it('picks up failed when nextAttemptAt has passed', () => {
    expect(
      isEligibleForPickup(row({ status: 'failed', nextAttemptAt: new Date(now.getTime() - 1000) }), now),
    ).toBe(true);
  });
  it('skips failed when nextAttemptAt is in future', () => {
    expect(
      isEligibleForPickup(row({ status: 'failed', nextAttemptAt: new Date(now.getTime() + 60_000) }), now),
    ).toBe(false);
  });
  it('skips processing/succeeded/dead_letter', () => {
    expect(isEligibleForPickup(row({ status: 'processing' }), now)).toBe(false);
    expect(isEligibleForPickup(row({ status: 'succeeded' }), now)).toBe(false);
    expect(isEligibleForPickup(row({ status: 'dead_letter' }), now)).toBe(false);
  });
  it('skips processing row even when nextAttemptAt is in the past (status guard, not just time)', () => {
    expect(
      isEligibleForPickup(
        row({ status: 'processing', nextAttemptAt: new Date(now.getTime() - 1000) }),
        now,
      ),
    ).toBe(false);
  });
  it('skips succeeded row even when nextAttemptAt is in the past (status guard, not just time)', () => {
    expect(
      isEligibleForPickup(
        row({ status: 'succeeded', nextAttemptAt: new Date(now.getTime() - 1000) }),
        now,
      ),
    ).toBe(false);
  });
  it('picks up failed when nextAttemptAt equals now (boundary)', () => {
    expect(isEligibleForPickup(row({ status: 'failed', nextAttemptAt: now }), now)).toBe(true);
  });
  it('skips failed with null nextAttemptAt (defensive)', () => {
    expect(isEligibleForPickup(row({ status: 'failed', nextAttemptAt: null }), now)).toBe(false);
  });
});
describe('@fleet/main-worker - RetryPolicy', () => {
  it('DEFAULT_RETRY_POLICY is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
  });
});
describe('@fleet/main-worker - nextStatusAfterAttempt (property-based)', () => {
  const policy: RetryPolicy = { maxAttempts: 5, baseSeconds: 1, jitterRatio: 0.25 };
  it('escalates to dead_letter only when attempts >= maxAttempts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (attempts, rand) => {
          const deps: AttemptDeps = { now: () => 0, random: () => rand };
          const r = nextStatusAfterAttempt(row({ attempts }), 'failure', policy, deps);
          if (attempts + 1 >= policy.maxAttempts) {
            return r.status === 'dead_letter' && r.nextAttemptAt === null;
          }
          return r.status === 'failed' && r.nextAttemptAt !== null;
        },
      ),
    );
  });
  it('success always succeeded regardless of attempts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (attempts) => {
        const r = nextStatusAfterAttempt(row({ attempts }), 'success', policy, deterministicDeps);
        return r.status === 'succeeded' && r.nextAttemptAt === null;
      }),
    );
  });
  it('jitter delay always within +/- jitterRatio of base', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (attempts, rand) => {
          const deps: AttemptDeps = { now: () => 0, random: () => rand };
          const r = nextStatusAfterAttempt(row({ attempts }), 'failure', policy, deps);
          if (r.status !== 'failed' || r.nextAttemptAt === null) return true;
          const baseMs = policy.baseSeconds * 2 ** (attempts + 1) * 1000;
          const minMs = baseMs * (1 - policy.jitterRatio);
          const maxMs = baseMs * (1 + policy.jitterRatio);
          return r.nextAttemptAt.getTime() >= minMs && r.nextAttemptAt.getTime() <= maxMs;
        },
      ),
    );
  });
});
