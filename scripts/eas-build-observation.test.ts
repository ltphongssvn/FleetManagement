// scripts/eas-build-observation.test.ts
// RED->GREEN spec for the TRUST BOUNDARY (L2) beneath the freshness gate:
// untrusted `eas build:list --json` output -> a typed BuildObservation.
//
// WHY THIS LAYER EXISTS SEPARATELY. The pure core (L3) takes epoch
// milliseconds and never parses strings, so exactly one place is responsible
// for deciding whether EAS told us something trustworthy. Zod belongs here and
// nowhere deeper: re-validating already-trusted internal data in every helper
// is the anti-pattern the boundary exists to remove.
//
// ANTI-CORRUPTION. EAS says FINISHED; the domain says SUCCESS. This module is
// the only place allowed to know that mapping, so provider vocabulary and
// provider status drift stop here instead of leaking into policy.
//
// THE DISTINCTION THAT MATTERS MOST. "the query worked and found nothing" and
// "the query did not work" are different facts with different remediation. The
// original outage was invisible partly because everything non-successful
// collapsed into one shape. So a non-JSON payload, a permissions error and a
// schema violation all become `unavailable` with a CODE -- never `no-success`,
// which would be a claim we have not earned.

import { describe, expect, it } from 'vitest';
import { parseBuildObservation } from './eas-build-observation.ts';

const iso = '2026-06-12T09:15:00.000Z';

describe('parseBuildObservation -- trustworthy evidence', () => {
  it('maps the newest FINISHED build to a success observation', () => {
    const o = parseBuildObservation(JSON.stringify([
      { id: 'b1', status: 'FINISHED', completedAt: iso },
    ]));
    expect(o.kind).toBe('success');
    if (o.kind !== 'success') expect.unreachable('narrowing');
    expect(o.atMs).toBe(Date.parse(iso));
  });

  it('selects the NEWEST success regardless of array order', () => {
    const older = '2026-05-01T00:00:00.000Z';
    const newer = '2026-07-01T00:00:00.000Z';
    const o = parseBuildObservation(JSON.stringify([
      { id: 'a', status: 'FINISHED', completedAt: older },
      { id: 'b', status: 'FINISHED', completedAt: newer },
    ]));
    if (o.kind !== 'success') expect.unreachable('narrowing');
    expect(
      o.atMs,
      'eas orders newest-first today, but freshness must not depend on an ' +
        'undocumented ordering guarantee that can change under us',
    ).toBe(Date.parse(newer));
  });

  it('ignores ERRORED and CANCELED builds when choosing the newest success', () => {
    const success = '2026-05-01T00:00:00.000Z';
    const failure = '2026-08-01T00:00:00.000Z';
    const o = parseBuildObservation(JSON.stringify([
      { id: 'x', status: 'ERRORED', completedAt: failure },
      { id: 'y', status: 'CANCELED', completedAt: failure },
      { id: 'z', status: 'FINISHED', completedAt: success },
    ]));
    if (o.kind !== 'success') expect.unreachable('narrowing');
    expect(
      o.atMs,
      'this is the whole outage in one assertion: fifteen recent ERRORED ' +
        'builds must not make the platform look freshly built',
    ).toBe(Date.parse(success));
  });
});

describe('parseBuildObservation -- honest absence', () => {
  it('reports no-success for an empty list', () => {
    const o = parseBuildObservation('[]');
    expect(o.kind).toBe('no-success');
  });

  it('reports no-success when every build failed', () => {
    const o = parseBuildObservation(JSON.stringify([
      { id: 'x', status: 'ERRORED', completedAt: iso },
    ]));
    expect(
      o.kind,
      'the query DID work and the answer is genuinely "none" -- that is a ' +
        'fact, unlike an unavailable query',
    ).toBe('no-success');
  });
});

describe('parseBuildObservation -- unavailable, never mistaken for absence', () => {
  it('reports unavailable when the payload is not JSON', () => {
    const o = parseBuildObservation('Resource not accessible by personal access token');
    expect(o.kind).toBe('unavailable');
    if (o.kind !== 'unavailable') expect.unreachable('narrowing');
    expect(o.code).toBe('ACQUISITION_FAILED');
  });

  it('reports unavailable when the payload is not an array', () => {
    const o = parseBuildObservation(JSON.stringify({ error: 'nope' }));
    expect(o.kind).toBe('unavailable');
  });

  it('reports unavailable when a build violates the schema', () => {
    const o = parseBuildObservation(JSON.stringify([{ id: 42, status: true }]));
    expect(
      o.kind,
      'a shape change in the eas CLI must stop the gate, not be silently ' +
        'read as "no successful build"',
    ).toBe('unavailable');
  });

  it('reports unavailable when a FINISHED build has an unparseable timestamp', () => {
    const o = parseBuildObservation(JSON.stringify([
      { id: 'b1', status: 'FINISHED', completedAt: 'yesterday-ish' },
    ]));
    expect(o.kind).toBe('unavailable');
    if (o.kind !== 'unavailable') expect.unreachable('narrowing');
    expect(o.code).toBe('NON_FINITE_TIMESTAMP');
  });

  it('reports unavailable when a FINISHED build has no completion time', () => {
    const o = parseBuildObservation(JSON.stringify([
      { id: 'b1', status: 'FINISHED', completedAt: null },
    ]));
    expect(
      o.kind,
      'a success we cannot date cannot be aged, and an undatable success must ' +
        'not silently become no-success',
    ).toBe('unavailable');
  });
});
