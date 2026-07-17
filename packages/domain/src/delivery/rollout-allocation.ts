// packages/domain/src/delivery/rollout-allocation.ts
// Progressive-delivery tenant allocation SSOT: who receives a rollout at a given
// stage. Two mechanisms, evaluated in order -- an explicit allowlist of internal
// tenants, then a stable percentage bucket for everyone else.
//
// rolloutKey is the bucketing salt, and it is load-bearing rather than
// decoration. Every 2026 implementation hashes the tenant id TOGETHER with the
// rollout or flag key: hash(targetingKey + flagName), crc32(userId + separator +
// flagHandle), combine userId + flagKey for independent distributions. Amplitude
// names the failure directly -- without the salt, any tenant allocated to the
// treatment gets the treatment in EVERY experiment. A naive hash(tenantId) would
// make the same unlucky tenants the canary for every release forever. The bucket
// must be stable PER ROLLOUT, not stable globally, and the key is an arbitrary
// salt rather than a vocabulary, so any string is valid.
//
// The allowlist is required and non-empty. A ladder starts at 0 percent
// internal-only, so with nobody allowlisted the first stage exposes the change to
// no one, produces no evidence, and the rollout can never leave stage one.
//
// A tenant id must be non-empty: without a targeting key the bucket is assigned
// randomly on each evaluation, so the same tenant may receive different values
// across requests and stickiness is silently lost. Rejecting beats defaulting,
// because a silent default looks healthy while the cohort churns underneath.
//
// Schema-first: RolloutAllocation derives via z.infer; no shape is hand-written.
import { z } from 'zod';

export const RolloutAllocationSchema = z
  .object({
    rolloutKey: z.string().min(1),
    allowlist: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((a) => new Set(a.allowlist).size === a.allowlist.length, {
    message: 'a duplicate tenant states one intent twice: each tenant is listed once',
  });

export type RolloutAllocation = z.infer<typeof RolloutAllocationSchema>;
