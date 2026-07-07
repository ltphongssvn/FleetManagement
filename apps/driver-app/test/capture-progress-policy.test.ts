// apps/driver-app/test/capture-progress-policy.test.ts
// RED-first (driver-min-interaction arc, U1): drivers on the road should not
// tap lifecycle buttons at all -- the photo IS the signal. Pure policy: given
// the run state (as last seen on the assignments list) and how many stops
// were still un-captured BEFORE this successful upload, decide which lifecycle
// intent to auto-fire through the forgiving factory (PR #235):
//   - planned|dispatched + more stops remain -> 'start' (first photo proves
//     the trip is underway; the forgiving walk supplies accept).
//   - ANY non-terminal state + this was the LAST remaining stop -> 'complete'
//     (the walk supplies accept/start as needed; the SERVER manifest gate
//     stays authoritative -- if it disagrees, MANIFESTS_INCOMPLETE banners).
//   - started + more stops remain -> null (nothing to advance yet).
//   - terminal/unknown states or bad remaining counts -> null (never guess).
// Client intent is best-effort; the server re-validates every transition.
// Fails at import resolution until capture-progress-policy.ts lands.
import { describe, it, expect } from 'vitest';
import { captureProgressIntent } from '../src/assignments/capture-progress-policy.js';

describe('captureProgressIntent', () => {
  it('first photo on a planned run auto-starts the trip', () => {
    expect(captureProgressIntent('planned', 2)).toBe('start');
    expect(captureProgressIntent('dispatched', 3)).toBe('start');
  });

  it('last remaining photo auto-completes from any non-terminal state', () => {
    expect(captureProgressIntent('planned', 1)).toBe('complete');
    expect(captureProgressIntent('dispatched', 1)).toBe('complete');
    expect(captureProgressIntent('started', 1)).toBe('complete');
  });

  it('mid-trip photo with stops remaining advances nothing', () => {
    expect(captureProgressIntent('started', 2)).toBeNull();
  });

  it('terminal and unknown states never fire', () => {
    expect(captureProgressIntent('completed', 1)).toBeNull();
    expect(captureProgressIntent('cancelled', 1)).toBeNull();
    expect(captureProgressIntent('weird', 1)).toBeNull();
  });

  it('non-positive or non-finite remaining counts never fire', () => {
    expect(captureProgressIntent('planned', 0)).toBeNull();
    expect(captureProgressIntent('planned', -1)).toBeNull();
    expect(captureProgressIntent('planned', Number.NaN)).toBeNull();
    expect(captureProgressIntent('planned', 1.5)).toBeNull();
  });

  it('state matching is case-insensitive like nextDriverAction', () => {
    expect(captureProgressIntent('PLANNED', 2)).toBe('start');
    expect(captureProgressIntent('Started', 1)).toBe('complete');
  });
});
