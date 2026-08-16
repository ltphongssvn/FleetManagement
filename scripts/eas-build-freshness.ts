// scripts/eas-build-freshness.ts
// Pure core of the native-build freshness gate: positive-evidence health.
// Narrative: context/eas-build-freshness-gate.md. Spec: this file's .test.ts.
//
// THE INVARIANT. For each shipped platform there must exist a SUCCESSFUL
// native build whose age is within policy. The absence of an error is not the
// presence of success -- iOS errored for two months while Sentry fatals fired
// and were dismissed, because nothing asserted recency of success.
//
// NO ZOD HERE, DELIBERATELY. Validation belongs at the trust boundary, where
// `eas build:list --json` is parsed into a BuildObservation; re-parsing already
// trusted internal data inside every helper is the anti-pattern that boundary
// exists to prevent. This module receives epoch milliseconds and a policy, and
// decides. It is pure: no clock, no network, no logging, no process exit.
//
// EXACT DURATION IS THE POLICY VARIABLE; HUMAN UNITS ARE PRESENTATION.
// Comparing rounded days would let 7d+1ms display as 7 and silently authorise.

/** Platforms this repo ships. One vocabulary, reused by the boundary schema. */
export const BUILD_PLATFORMS = ['ios', 'android'] as const;
export type BuildPlatform = (typeof BUILD_PLATFORMS)[number];

/** Closed set: agents and humans branch on codes, never on prose. */
export type ObservationCode =
  | 'ACQUISITION_FAILED'
  | 'FUTURE_TIMESTAMP'
  | 'NON_FINITE_TIMESTAMP';

export type PolicyCode =
  | 'NON_POSITIVE_WINDOW'
  | 'NON_FINITE_WINDOW'
  | 'NON_FINITE_CLOCK';

/**
 * What the boundary managed to learn. `unavailable` is NOT `no-success`:
 * a timed-out or unauthorised query is UNKNOWN, and collapsing the two would
 * erase the provenance of uncertainty and let a broken query read as a fact.
 */
export type BuildObservation =
  | { readonly kind: 'success'; readonly atMs: number }
  | { readonly kind: 'no-success' }
  | { readonly kind: 'unavailable'; readonly code: ObservationCode };

export interface FreshnessInput {
  readonly observation: BuildObservation;
  readonly nowMs: number;
  readonly maxAgeMs: number;
  readonly platform: BuildPlatform;
}

export type FreshnessVerdict =
  | { readonly kind: 'fresh'; readonly platform: BuildPlatform; readonly ageMs: number; readonly maxAgeMs: number }
  | { readonly kind: 'stale'; readonly platform: BuildPlatform; readonly ageMs: number; readonly maxAgeMs: number }
  | { readonly kind: 'never'; readonly platform: BuildPlatform; readonly maxAgeMs: number }
  | { readonly kind: 'invalid-observation'; readonly platform: BuildPlatform; readonly code: ObservationCode }
  | { readonly kind: 'invalid-policy'; readonly platform: BuildPlatform; readonly code: PolicyCode };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function assertNever(x: never): never {
  throw new Error('unhandled verdict: ' + JSON.stringify(x));
}

/**
 * Decide. Policy is checked BEFORE evidence: a misconfigured window makes
 * every verdict meaningless, and reporting it as an evidence problem would
 * send remediation to the wrong place.
 */
export function classifyBuildFreshness(input: FreshnessInput): FreshnessVerdict {
  const { observation, nowMs, maxAgeMs, platform } = input;

  if (!Number.isFinite(maxAgeMs)) {
    return { kind: 'invalid-policy', platform, code: 'NON_FINITE_WINDOW' };
  }
  if (maxAgeMs <= 0) {
    return { kind: 'invalid-policy', platform, code: 'NON_POSITIVE_WINDOW' };
  }
  if (!Number.isFinite(nowMs)) {
    return { kind: 'invalid-policy', platform, code: 'NON_FINITE_CLOCK' };
  }

  if (observation.kind === 'unavailable') {
    return { kind: 'invalid-observation', platform, code: observation.code };
  }
  if (observation.kind === 'no-success') {
    return { kind: 'never', platform, maxAgeMs };
  }

  if (!Number.isFinite(observation.atMs)) {
    return { kind: 'invalid-observation', platform, code: 'NON_FINITE_TIMESTAMP' };
  }
  const ageMs = nowMs - observation.atMs;
  if (ageMs < 0) {
    return { kind: 'invalid-observation', platform, code: 'FUTURE_TIMESTAMP' };
  }

  // Inclusive at the threshold: a gate that fires exactly at the boundary is a
  // daily coin-flip, and flapping is how a control earns being ignored.
  return ageMs <= maxAgeMs
    ? { kind: 'fresh', platform, ageMs, maxAgeMs }
    : { kind: 'stale', platform, ageMs, maxAgeMs };
}

export interface FreshnessTelemetry {
  readonly event: 'native_build_freshness_evaluated';
  readonly verdict: FreshnessVerdict['kind'];
  readonly platform: BuildPlatform;
  readonly ageMs: number | null;
  readonly maxAgeMs: number | null;
  readonly code: string | null;
}

/**
 * Structured truth. Machine consumers read these fields; the prose below is
 * derived from the same verdict rather than being parsed by anything.
 */
export function telemetryFor(v: FreshnessVerdict): FreshnessTelemetry {
  const base = { event: 'native_build_freshness_evaluated', verdict: v.kind, platform: v.platform } as const;
  switch (v.kind) {
    case 'fresh':
    case 'stale':
      return { ...base, ageMs: v.ageMs, maxAgeMs: v.maxAgeMs, code: null };
    case 'never':
      // null, not 0: there is no age, and a zero would read as "just built".
      return { ...base, ageMs: null, maxAgeMs: v.maxAgeMs, code: null };
    case 'invalid-observation':
    case 'invalid-policy':
      return { ...base, ageMs: null, maxAgeMs: null, code: v.code };
    default:
      return assertNever(v);
  }
}

/**
 * Human duration. Days alone printed "0d old" for a build from this morning,
 * which reads as broken even when the verdict is correct -- and a line people
 * squint at is a line people stop reading. Sub-day ages get hours.
 */
function humanAge(ms: number): string {
  if (ms < HOUR_MS) return String(Math.floor(ms / (60 * 1000))) + 'm';
  if (ms < DAY_MS) return String(Math.floor(ms / HOUR_MS)) + 'h';
  return String(Math.floor(ms / DAY_MS)) + 'd';
}

/** Operator prose. Exhaustive: a new verdict fails the build, not silently. */
export function describeVerdict(v: FreshnessVerdict): string {
  switch (v.kind) {
    case 'fresh':
      return v.platform + ': last successful build is ' + humanAge(v.ageMs) +
        ' old, within the ' + humanAge(v.maxAgeMs) + ' window';
    case 'stale':
      return v.platform + ': last successful build is ' + humanAge(v.ageMs) +
        ' old, beyond the ' + humanAge(v.maxAgeMs) + ' window -- native builds ' +
        'have been failing or skipped since then';
    case 'never':
      return v.platform + ': no successful native build exists at all within ' +
        'the queried history';
    case 'invalid-observation':
      return v.platform + ': freshness could not be established from the ' +
        'available evidence (' + v.code + ')';
    case 'invalid-policy':
      return v.platform + ': the freshness policy itself is invalid (' + v.code + ')';
    default:
      return assertNever(v);
  }
}

/**
 * Fail-closed: ONLY fresh authorises. Every other state -- including the ones
 * caused by our own misconfiguration -- must deny, or an inability to prove
 * freshness would quietly produce success, which is the original defect.
 */
export function exitCodeFor(v: FreshnessVerdict): number {
  switch (v.kind) {
    case 'fresh':
      return 0;
    case 'stale':
      return 1;
    case 'never':
      return 2;
    case 'invalid-observation':
      return 3;
    case 'invalid-policy':
      return 4;
    default:
      return assertNever(v);
  }
}
