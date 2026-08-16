// scripts/eas-build-observation.ts
// TRUST BOUNDARY (L2) beneath the freshness gate: untrusted
// `eas build:list --json` stdout -> a typed BuildObservation for the pure core.
//
// ZOD LIVES HERE AND NOWHERE DEEPER. Parse once, at the edge where external
// data enters; the core then operates on trusted values. Re-validating
// internal data in every helper is the anti-pattern this boundary removes.
//
// ANTI-CORRUPTION LAYER. EAS says FINISHED, the domain says SUCCESS. This is
// the only module permitted to know that mapping, so provider vocabulary and
// provider status drift stop here rather than leaking into policy.
//
// UNAVAILABLE IS NOT ABSENCE. A non-JSON payload (a fine-grained-PAT failure
// emits prose, cli/cli#12597), a shape change, or an undatable success are all
// states where we did NOT learn the answer. Reporting them as `no-success`
// would assert a fact we have not earned -- and collapsing every non-success
// into one shape is part of why the two-month iOS outage stayed invisible.
//
// COMPLETENESS MATTERS. The caller must not truncate the list it passes here
// (no `| head -n`): presentation may truncate, decision evidence must not, or
// the newest success can fall outside the window we reason over.

import { z } from 'zod';
import type { BuildObservation, ObservationCode } from './eas-build-freshness.ts';

/**
 * Deliberately LOOSE (`looseObject`): this is a third-party payload and EAS
 * adds fields over time. A strict schema would fail the gate on every harmless
 * addition, which is how a control earns being disabled. Only the fields the
 * decision depends on are constrained.
 */
const EasBuildSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  completedAt: z.string().nullish(),
});

const EasBuildListSchema = z.array(EasBuildSchema);

/** The one place that knows EAS's success vocabulary. */
const SUCCESS_STATUS = 'FINISHED';

// ObservationCode is imported, not re-derived. An earlier draft extracted it
// with `BuildObservation extends { kind: 'unavailable'; code: infer C } ? ...`,
// which silently resolved to `never`: conditional types distribute ONLY over a
// naked type parameter, and a concrete union checked against a pattern simply
// fails the test as a whole. The type already had a name and an export; the
// clever version was both wrong and harder to read.
const unavailable = (code: ObservationCode): BuildObservation => ({ kind: 'unavailable', code });

export function parseBuildObservation(raw: string): BuildObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Not JSON at all -- eas emitted prose (auth failure, usage error). The
    // query did not work; we learned nothing about builds.
    return unavailable('ACQUISITION_FAILED');
  }

  const res = EasBuildListSchema.safeParse(parsed);
  if (!res.success) return unavailable('ACQUISITION_FAILED');

  const successes = res.data.filter((b) => b.status.toUpperCase() === SUCCESS_STATUS);
  if (successes.length === 0) return { kind: 'no-success' };

  // A success we cannot date cannot be aged. Fail closed rather than skip it:
  // skipping would silently age the gate off an older build.
  const stamps: number[] = [];
  for (const b of successes) {
    if (b.completedAt === null || b.completedAt === undefined) {
      return unavailable('NON_FINITE_TIMESTAMP');
    }
    const ms = Date.parse(b.completedAt);
    if (!Number.isFinite(ms)) return unavailable('NON_FINITE_TIMESTAMP');
    stamps.push(ms);
  }

  // Newest by value, never by array position: eas orders newest-first today,
  // but freshness must not rest on an undocumented ordering guarantee.
  return { kind: 'success', atMs: Math.max(...stamps) };
}
