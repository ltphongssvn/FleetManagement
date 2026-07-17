// packages/domain/test/rollout-allocation.test.ts
// RED-first contract test for tenant allocation: who receives a rollout at a
// given stage. Two mechanisms, in order -- an explicit allowlist of internal
// tenants, then a stable percentage bucket for everyone else.
//
// rolloutKey is the bucketing salt and it is load-bearing, not decoration.
// Every 2026 implementation hashes the tenant id TOGETHER with the rollout or
// flag key: hash(targetingKey + flagName), crc32(userId + separator + flagHandle),
// combine userId + flagKey. Amplitude names the failure directly -- without the
// salt, any tenant allocated to the treatment gets the treatment in EVERY
// experiment. A naive hash(tenantId) would make the same unlucky tenants the
// canary for every release forever, so the bucket must be stable per rollout,
// not stable globally.
//
// The allowlist must be non-empty. A ladder starts at 0 percent internal-only,
// so with nobody allowlisted the first stage exposes the change to no one,
// produces no evidence, and the rollout can never leave stage one.
//
// A tenant id must be non-empty: without a targeting key the bucket is assigned
// randomly on each evaluation, so the same tenant may receive different values
// across requests and stickiness is silently lost. Rejecting beats defaulting.
//
// Schema-first: types are z.infer; this file never re-declares the shape.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  RolloutAllocationSchema,
  type RolloutAllocation,
} from '../src/delivery/rollout-allocation.js';

const allocation = {
  rolloutKey: 'progressive-delivery-2026-07',
  allowlist: ['tenant-internal-ops', 'tenant-internal-qa'],
};

describe('rollout allocation: the shape the evaluator reads', () => {
  it('accepts a well-formed allocation', () => {
    expect(RolloutAllocationSchema.parse(allocation)).toEqual(allocation);
  });

  it('accepts a single allowlisted tenant', () => {
    const one = { ...allocation, allowlist: ['tenant-internal-ops'] };
    expect(RolloutAllocationSchema.parse(one).allowlist).toHaveLength(1);
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    expect(() => RolloutAllocationSchema.parse({ ...allocation, percent: 10 })).toThrow();
  });
});

describe('rollout allocation: the rolloutKey is the bucketing salt', () => {
  it('rejects an empty rolloutKey, which would collapse every rollout onto one bucketing', () => {
    expect(() => RolloutAllocationSchema.parse({ ...allocation, rolloutKey: '' })).toThrow();
  });

  it('rejects a missing rolloutKey rather than defaulting to an unsalted hash', () => {
    expect(() => RolloutAllocationSchema.parse({ allowlist: allocation.allowlist })).toThrow();
  });

  it('accepts an arbitrary rollout key, since it is a salt and not a vocabulary', () => {
    const custom = { ...allocation, rolloutKey: 'ui-409-conflict-presentation' };
    expect(RolloutAllocationSchema.parse(custom).rolloutKey).toBe('ui-409-conflict-presentation');
  });
});

describe('rollout allocation: the allowlist gates the internal stage', () => {
  it('rejects an empty allowlist, which would expose the internal stage to nobody', () => {
    expect(() => RolloutAllocationSchema.parse({ ...allocation, allowlist: [] })).toThrow();
  });

  it('rejects a missing allowlist rather than defaulting to nobody internal', () => {
    expect(() => RolloutAllocationSchema.parse({ rolloutKey: allocation.rolloutKey })).toThrow();
  });

  it('rejects an empty tenant id, which cannot produce a stable bucket', () => {
    expect(() => RolloutAllocationSchema.parse({ ...allocation, allowlist: [''] })).toThrow();
  });

  it('rejects a duplicate tenant, which states one intent twice', () => {
    const dup = { ...allocation, allowlist: ['tenant-a', 'tenant-a'] };
    expect(() => RolloutAllocationSchema.parse(dup)).toThrow();
  });

  it('accepts distinct tenants', () => {
    const many = { ...allocation, allowlist: ['tenant-a', 'tenant-b', 'tenant-c'] };
    expect(RolloutAllocationSchema.parse(many).allowlist).toHaveLength(3);
  });
});

describe('rollout allocation: types derive from the schema, never re-declared', () => {
  it('narrows rolloutKey to a string', () => {
    expectTypeOf<RolloutAllocation['rolloutKey']>().toEqualTypeOf<string>();
  });

  it('narrows the allowlist to an array of strings', () => {
    expectTypeOf<RolloutAllocation['allowlist']>().toEqualTypeOf<string[]>();
  });
});
