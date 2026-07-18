// packages/domain/test/rollout-bucket.test.ts
// RED-first test for stable tenant bucketing: the pure function that decides
// whether a tenant is exposed at a given rollout stage.
//
// Order: the allowlist wins, then the bucket. An allowlisted tenant is exposed at
// every stage including the internal one at 0 percent -- that is what internal
// means. Everyone else is exposed when their bucket is below the stage exposure,
// which is the bucket < percent rule every implementation uses.
//
// Three properties are load-bearing.
//
// STABLE: the same tenant always lands in the same bucket for a given rollout, so
// the cohort does not churn between evaluations. Without stickiness the metrics
// are garbage, because a tenant that saw the canary at one sample sees the old
// version at the next.
//
// SALTED: the bucket depends on the rolloutKey, so two rollouts pick different
// tenants. Without the salt the same unlucky tenants are the canary for every
// release forever.
//
// MONOTONIC: exposure only ever widens. A tenant exposed at 10 percent is still
// exposed at 50 percent -- at 1 percent bucket 0 is in, at 10 percent buckets 0-9,
// at 50 percent buckets 0-49, and the original 1 percent are always included.
// Re-bucketing on ramp would invalidate every measurement taken so far.
//
// The hash is pure TypeScript, not node:crypto: @fleet/domain currently imports
// zero Node built-ins and is consumed by ops-web, where domain code can reach a
// client bundle or the edge runtime. A Node-only import would make the package
// non-isomorphic.
import { describe, it, expect } from 'vitest';
import { bucketFor, isTenantExposed } from '../src/delivery/rollout-bucket.js';
import { DEFAULT_ROLLOUT_LADDER } from '../src/delivery/rollout-stage.js';

const KEY = 'progressive-delivery-2026-07';
const OTHER_KEY = 'ui-409-conflict-presentation';
const allocation = { rolloutKey: KEY, allowlist: ['tenant-internal-ops'] };
const internalStage = { exposurePercent: 0, internalOnly: true };
const fullStage = { exposurePercent: 100, internalOnly: false };

function tenants(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'tenant-' + String(i));
}

describe('bucketFor: every tenant lands in 0-99', () => {
  it('never returns a bucket outside the range', () => {
    const buckets = tenants(500).map((t) => bucketFor(t, KEY));
    expect(buckets.every((b) => Number.isInteger(b) && b >= 0 && b <= 99)).toBe(true);
  });

  it('spreads tenants across many buckets rather than collapsing onto one', () => {
    const distinct = new Set(tenants(500).map((t) => bucketFor(t, KEY)));
    expect(distinct.size).toBeGreaterThan(50);
  });
});

describe('bucketFor: stable', () => {
  it('returns the same bucket for the same tenant every time', () => {
    const first = bucketFor('tenant-42', KEY);
    for (let i = 0; i < 20; i += 1) {
      expect(bucketFor('tenant-42', KEY)).toBe(first);
    }
  });

  it('does not depend on evaluation order', () => {
    const direct = bucketFor('tenant-7', KEY);
    tenants(50).forEach((t) => bucketFor(t, KEY));
    expect(bucketFor('tenant-7', KEY)).toBe(direct);
  });
});

describe('bucketFor: salted by the rollout key', () => {
  it('gives a tenant an independent bucket per rollout', () => {
    const differing = tenants(200).filter((t) => bucketFor(t, KEY) !== bucketFor(t, OTHER_KEY));
    expect(differing.length).toBeGreaterThan(100);
  });

  it('does not simply ignore the key', () => {
    const a = tenants(100).map((t) => bucketFor(t, KEY));
    const b = tenants(100).map((t) => bucketFor(t, OTHER_KEY));
    expect(a).not.toEqual(b);
  });
});

describe('isTenantExposed: the allowlist wins', () => {
  it('exposes an allowlisted tenant at the internal stage, where nobody else is', () => {
    expect(isTenantExposed('tenant-internal-ops', allocation, internalStage)).toBe(true);
  });

  it('does not expose a non-allowlisted tenant at the internal stage', () => {
    const exposed = tenants(200).filter((t) => isTenantExposed(t, allocation, internalStage));
    expect(exposed).toEqual([]);
  });

  it('still exposes an allowlisted tenant once traffic widens', () => {
    const ramp = { exposurePercent: 10, internalOnly: false };
    expect(isTenantExposed('tenant-internal-ops', allocation, ramp)).toBe(true);
  });
});

describe('isTenantExposed: bucket rule for everyone else', () => {
  it('exposes every tenant at 100 percent', () => {
    expect(tenants(200).every((t) => isTenantExposed(t, allocation, fullStage))).toBe(true);
  });

  it('exposes roughly the stage percentage of tenants', () => {
    const ramp = { exposurePercent: 10, internalOnly: false };
    const exposed = tenants(1000).filter((t) => isTenantExposed(t, allocation, ramp));
    expect(exposed.length).toBeGreaterThan(50);
    expect(exposed.length).toBeLessThan(160);
  });
});

describe('isTenantExposed: monotonic across the ladder', () => {
  it('never drops a tenant that was already exposed at a narrower stage', () => {
    const pool = tenants(300);
    let previous: string[] = [];
    for (const stage of DEFAULT_ROLLOUT_LADDER) {
      const exposed = pool.filter((t) => isTenantExposed(t, allocation, stage));
      for (const t of previous) {
        expect(exposed).toContain(t);
      }
      previous = exposed;
    }
  });

  it('widens exposure at every rung', () => {
    const pool = tenants(300);
    const counts = DEFAULT_ROLLOUT_LADDER.map(
      (stage) => pool.filter((t) => isTenantExposed(t, allocation, stage)).length,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[counts.length - 1]).toBe(300);
  });
});
