// apps/driver-app/test/vn-retry-policy.test.ts
// TDD RED: cross-region retry tuning. Drivers on mobile networks in Vietnam
// reach a backend on Railway (US/SG). Higher and more variable RTT means the
// raw server retryPolicy is too aggressive: first retry too soon, jitter too
// narrow (retry storms), attempt ceiling too low for transient mobile loss.
// Pure function: server RetryEntry -> VN-adjusted RetryEntry. Bounded so it
// can never make a policy worse (clamps, never shrinks attempts/backoff).
import { describe, it, expect } from 'vitest';
import { adjustRetryForVn, adjustRetryMap } from '../src/config/vn-retry-policy.js';

const base = { maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.1 };

describe('vn-retry-policy', () => {
  it('raises baseSeconds to absorb cross-region RTT (>= 2s floor)', () => {
    expect(adjustRetryForVn(base).baseSeconds).toBeGreaterThanOrEqual(2);
  });

  it('never reduces baseSeconds below the server value', () => {
    const big = { maxAttempts: 3, baseSeconds: 10, jitterRatio: 0.2 };
    expect(adjustRetryForVn(big).baseSeconds).toBeGreaterThanOrEqual(10);
  });

  it('widens jitter to avoid synchronized retry storms (>= 0.3)', () => {
    expect(adjustRetryForVn(base).jitterRatio).toBeGreaterThanOrEqual(0.3);
  });

  it('clamps jitter at 1.0 and never below the server value', () => {
    const wide = { maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.9 };
    const out = adjustRetryForVn(wide);
    expect(out.jitterRatio).toBeLessThanOrEqual(1);
    expect(out.jitterRatio).toBeGreaterThanOrEqual(0.9);
  });

  it('raises the attempt ceiling for transient mobile loss (>= 5)', () => {
    expect(adjustRetryForVn(base).maxAttempts).toBeGreaterThanOrEqual(5);
  });

  it('never reduces maxAttempts below the server value', () => {
    const many = { maxAttempts: 8, baseSeconds: 1, jitterRatio: 0.1 };
    expect(adjustRetryForVn(many).maxAttempts).toBeGreaterThanOrEqual(8);
  });

  it('is idempotent (adjusting an adjusted policy changes nothing)', () => {
    const once = adjustRetryForVn(base);
    expect(adjustRetryForVn(once)).toEqual(once);
  });

  it('adjustRetryMap maps every entry, preserving keys', () => {
    const map = { upload: base, sync: { maxAttempts: 6, baseSeconds: 3, jitterRatio: 0.5 } };
    const out = adjustRetryMap(map);
    expect(Object.keys(out).sort()).toEqual(['sync', 'upload']);
    expect(out['upload']?.baseSeconds).toBeGreaterThanOrEqual(2);
    expect(out['sync']?.maxAttempts).toBeGreaterThanOrEqual(6);
  });

  it('does not mutate the input entry', () => {
    const input = { maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.1 };
    adjustRetryForVn(input);
    expect(input).toEqual({ maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.1 });
  });
});
