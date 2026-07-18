// packages/domain/src/delivery/rollout-bucket.ts
// Stable tenant bucketing: the pure decision of whether a tenant is exposed at a
// given rollout stage. Application-level progressive delivery, so this is a
// function of the tenant and the config, never of a request or a clock.
//
// Order: the allowlist wins, then the bucket. An allowlisted tenant is exposed at
// every stage including the internal one at 0 percent -- that is what internal
// means. Everyone else is exposed when their bucket is below the stage exposure.
//
// Three properties, each load-bearing.
//
// STABLE. The same tenant always lands in the same bucket for a given rollout, so
// the cohort cannot churn between evaluations. A pure hash needs no storage and
// gives the same answer on any server and after any restart. Without stickiness
// the metrics are garbage: a tenant that saw the canary at one sample sees the old
// version at the next, and the analysis is measuring noise.
//
// SALTED. The bucket is hashed from the tenant id AND the rolloutKey, so two
// rollouts pick different tenants. Without the salt the same unlucky tenants are
// the canary for every release forever -- the failure Amplitude names directly.
//
// MONOTONIC. bucket < exposurePercent only ever widens the cohort: at 1 percent
// bucket 0 is in, at 10 percent buckets 0-9, at 50 percent buckets 0-49, and the
// original 1 percent are always included. Re-bucketing on ramp would invalidate
// every measurement taken so far, so this comparison is the contract, not an
// implementation detail.
//
// FNV-1a rather than node:crypto. @fleet/domain imports zero Node built-ins and is
// consumed by ops-web, where domain code can reach a client bundle or the edge
// runtime; a Node-only import would make the package non-isomorphic. The hash needs
// to be deterministic and well-distributed, not cryptographic -- nothing here is a
// secret, and an attacker gains nothing from predicting a rollout bucket.
import type { RolloutStage } from './rollout-stage.js';
import type { RolloutAllocation } from './rollout-allocation.js';

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const BUCKET_COUNT = 100;

/**
 * FNV-1a over the salted key, forced to an unsigned 32-bit result.
 * Math.imul keeps the multiply in 32-bit space instead of drifting into
 * floating point, and the unsigned shift is what makes the value non-negative.
 */
function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The stable bucket 0-99 for a tenant within one rollout. Salted with the
 * rolloutKey so each rollout draws an independent cohort.
 */
export function bucketFor(tenantId: string, rolloutKey: string): number {
  return fnv1a(rolloutKey + ':' + tenantId) % BUCKET_COUNT;
}

/**
 * Whether a tenant receives the new version at this stage. Allowlist first, then
 * the stable bucket. Pure: same inputs, same answer, on every server.
 */
export function isTenantExposed(
  tenantId: string,
  allocation: RolloutAllocation,
  stage: RolloutStage,
): boolean {
  if (allocation.allowlist.includes(tenantId)) return true;
  return bucketFor(tenantId, allocation.rolloutKey) < stage.exposurePercent;
}
