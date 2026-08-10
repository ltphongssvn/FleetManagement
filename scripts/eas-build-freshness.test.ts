// scripts/eas-build-freshness.test.ts
// RED->GREEN spec for the native-build freshness gate: the pure core that
// answers "does recent POSITIVE EVIDENCE of a successful build exist?"
//
// WHY THIS EXISTS (full narrative: context/eas-build-freshness-gate.md).
// iOS EAS builds failed for ~2 months -- 15 consecutive ERRORED builds, last
// success 2026-06-12 -- until a driver could not install the app. The alerting
// was NOT missing: eas-inbound.controller.ts raised a Sentry fatal every time,
// so fifteen fatals fired correctly and were dismissed. What was absent is a
// check on the ABSENCE OF SUCCESS: the webhook records failure loudly and
// success silently, so nothing could answer "when did iOS last succeed?".
// The fingerprint short-circuit then hid it further -- runs either matched the
// stale finished build and skipped, or dispatched and errored.
//
// So the invariant is outcome-oriented, not activity-oriented, and it is a
// GATE rather than a notification: an alert nobody acts on protects nothing.
//
// SCOPE. This file is the PURE CORE (L3). It takes epoch milliseconds, never
// strings: parsing `eas build:list --json` is the boundary's job (L2), so the
// core neither re-validates trusted data nor inherits EAS's FINISHED
// vocabulary. Freshness proves recency of success only -- NOT provenance,
// profile, channel or installability. Those are separate gates.

import { describe, expect, it } from 'vitest';
import {
  classifyBuildFreshness,
  describeVerdict,
  exitCodeFor,
  telemetryFor,
} from './eas-build-freshness.ts';

const NOW = Date.parse('2026-08-09T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;
const IOS = 'ios';

const at = (msAgo: number) => ({ kind: 'success', atMs: NOW - msAgo } as const);
const policy = { nowMs: NOW, maxAgeMs: WINDOW_MS, platform: IOS } as const;

describe('classifyBuildFreshness -- authorising states', () => {
  it('is fresh well inside the window', () => {
    const v = classifyBuildFreshness({ observation: at(2 * DAY_MS), ...policy });
    expect(v.kind).toBe('fresh');
  });

  it('is fresh at exactly the threshold, so a daily gate cannot flap', () => {
    const v = classifyBuildFreshness({ observation: at(WINDOW_MS), ...policy });
    expect(
      v.kind,
      'firing exactly at the boundary makes the gate a daily coin-flip and ' +
        'trains operators to ignore it',
    ).toBe('fresh');
  });

  it('is fresh one millisecond before the threshold', () => {
    const v = classifyBuildFreshness({ observation: at(WINDOW_MS - 1), ...policy });
    expect(v.kind).toBe('fresh');
  });
});

describe('classifyBuildFreshness -- denying states', () => {
  it('is stale one millisecond past the threshold', () => {
    const v = classifyBuildFreshness({ observation: at(WINDOW_MS + 1), ...policy });
    expect(
      v.kind,
      'policy must compare exact duration; if it compared ROUNDED days then ' +
        '7d+1ms would display as 7 and silently authorise',
    ).toBe('stale');
  });

  it('is stale for the real 2026-06-12 case and carries exact age', () => {
    const v = classifyBuildFreshness({ observation: at(58 * DAY_MS), ...policy });
    if (v.kind !== 'stale') {
      expect.unreachable('expected stale');
    }
    expect(v.ageMs).toBe(58 * DAY_MS);
    expect(v.platform).toBe(IOS);
  });

  it('is never when the query succeeded and found no successful build', () => {
    const v = classifyBuildFreshness({ observation: { kind: 'no-success' }, ...policy });
    expect(
      v.kind,
      'a project whose every build errored has no success to age; that is ' +
        'distinct from stale and must never read as fresh',
    ).toBe('never');
  });

  it('is invalid-observation -- NOT never -- when acquisition itself failed', () => {
    const v = classifyBuildFreshness({
      observation: { kind: 'unavailable', code: 'ACQUISITION_FAILED' },
      ...policy,
    });
    expect(
      v.kind,
      'a timed-out or unauthorised eas query is UNKNOWN, not proof of no ' +
        'success; collapsing both into never erases the provenance of doubt',
    ).toBe('invalid-observation');
    if (v.kind !== 'invalid-observation') expect.unreachable('narrowing');
    expect(v.code).toBe('ACQUISITION_FAILED');
  });
});

describe('classifyBuildFreshness -- fail-closed on impossible inputs', () => {
  it('refuses a build timestamp in the future', () => {
    const v = classifyBuildFreshness({ observation: at(-5 * DAY_MS), ...policy });
    expect(v.kind).toBe('invalid-observation');
    if (v.kind !== 'invalid-observation') expect.unreachable('narrowing');
    expect(
      v.code,
      'clock skew or a wrong field would otherwise satisfy the gate forever',
    ).toBe('FUTURE_TIMESTAMP');
  });

  it('refuses a non-finite build timestamp', () => {
    const v = classifyBuildFreshness({
      observation: { kind: 'success', atMs: Number.NaN },
      ...policy,
    });
    expect(v.kind).toBe('invalid-observation');
  });

  it('refuses a non-positive window as invalid POLICY, not bad evidence', () => {
    const v = classifyBuildFreshness({ observation: at(DAY_MS), ...policy, maxAgeMs: 0 });
    expect(
      v.kind,
      'misconfiguration and untrustworthy evidence need different remediation, ' +
        'so they must not share a verdict',
    ).toBe('invalid-policy');
    if (v.kind !== 'invalid-policy') expect.unreachable('narrowing');
    expect(v.code).toBe('NON_POSITIVE_WINDOW');
  });

  it('refuses a non-finite window', () => {
    const v = classifyBuildFreshness({
      observation: at(DAY_MS),
      ...policy,
      maxAgeMs: Number.POSITIVE_INFINITY,
    });
    expect(v.kind).toBe('invalid-policy');
    if (v.kind !== 'invalid-policy') expect.unreachable('narrowing');
    expect(v.code).toBe('NON_FINITE_WINDOW');
  });

  it('refuses a non-finite clock', () => {
    const v = classifyBuildFreshness({ observation: at(DAY_MS), ...policy, nowMs: Number.NaN });
    expect(v.kind).toBe('invalid-policy');
  });
});

describe('exitCodeFor -- inability to prove freshness never yields success', () => {
  it('authorises only fresh', () => {
    expect(exitCodeFor({ kind: 'fresh', platform: IOS, ageMs: 0, maxAgeMs: WINDOW_MS })).toBe(0);
  });

  it('denies every non-fresh verdict', () => {
    const denied = [
      { kind: 'stale', platform: IOS, ageMs: 99, maxAgeMs: WINDOW_MS },
      { kind: 'never', platform: IOS, maxAgeMs: WINDOW_MS },
      { kind: 'invalid-observation', platform: IOS, code: 'FUTURE_TIMESTAMP' },
      { kind: 'invalid-policy', platform: IOS, code: 'NON_POSITIVE_WINDOW' },
    ] as const;
    for (const v of denied) {
      expect(exitCodeFor(v), v.kind + ' must not exit 0').toBeGreaterThan(0);
    }
  });
});

describe('telemetryFor -- structured truth, prose derived separately', () => {
  it('emits machine fields rather than requiring a sentence to be parsed', () => {
    const v = classifyBuildFreshness({ observation: at(58 * DAY_MS), ...policy });
    const t = telemetryFor(v);
    expect(t.event).toBe('native_build_freshness_evaluated');
    expect(t.verdict).toBe('stale');
    expect(t.platform).toBe(IOS);
    expect(t.ageMs).toBe(58 * DAY_MS);
    expect(t.maxAgeMs).toBe(WINDOW_MS);
  });

  it('omits age for never rather than reporting a misleading zero', () => {
    const t = telemetryFor({ kind: 'never', platform: IOS, maxAgeMs: WINDOW_MS });
    expect(t.ageMs).toBeNull();
  });
});

describe('describeVerdict -- operator prose', () => {
  it('names platform, rounded age and the window when stale', () => {
    const msg = describeVerdict({
      kind: 'stale', platform: IOS, ageMs: 58 * DAY_MS, maxAgeMs: WINDOW_MS,
    });
    expect(msg).toContain(IOS);
    expect(msg, 'humans read days even though policy compares ms').toContain('58');
    expect(msg).toContain('7');
  });

  it('says plainly that no successful build exists, never phrased as an age', () => {
    const msg = describeVerdict({ kind: 'never', platform: IOS, maxAgeMs: WINDOW_MS });
    expect(msg).toContain('no successful');
  });

  it('reports the closed code for invalid states', () => {
    const msg = describeVerdict({
      kind: 'invalid-observation', platform: IOS, code: 'ACQUISITION_FAILED',
    });
    expect(msg).toContain('ACQUISITION_FAILED');
  });
});
