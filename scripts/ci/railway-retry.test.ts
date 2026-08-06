// scripts/ci/railway-retry.test.ts
// RED: Deploy to Railway wrapped railway up in nothing at all. On 2026-07-28
// the upload succeeded and the build was triggered, then the CLI timed out
// polling backboard.railway.com/graphql/v2 with a reqwest operation-timed-out
// error. The job exited 1, the whole run went red, and pr:follow correctly
// reported PR #435 FAILED at deploy. Re-running the same failed job passed
// unchanged -- the signature of a transient fault, not a defect in the commit.
//
// A blind retry is the WRONG fix: retrying an auth failure or a genuine build
// failure burns CI minutes and hides a real defect behind noise. So the policy
// FAILS CLOSED -- only output positively recognised as transient is retried,
// and anything unrecognised is fatal. This mirrors the audit:ci-minutes rule
// that absent data throws rather than scoring a confident zero.
import { describe, it, expect } from 'vitest';
import {
  classifyRailwayFailure,
  shouldRetry,
  backoffMs,
  MAX_ATTEMPTS,
} from './railway-retry';

// The verbatim tail of the 2026-07-28 Deploy worker failure.
const INCIDENT_OUTPUT = [
  'Indexing...',
  'Uploading...',
  'CI mode enabled',
  'reqwest error',
  'Caused by:',
  '    0: error sending request for url (https://backboard.railway.com/graphql/v2)',
  '    1: operation timed out',
].join(String.fromCharCode(10));

describe('classifyRailwayFailure', () => {
  it('classifies the 2026-07-28 backboard timeout as transient', () => {
    expect(classifyRailwayFailure(INCIDENT_OUTPUT)).toBe('transient');
  });
  const TRANSIENT = [
    'error sending request for url (https://backboard.railway.com/graphql/v2)',
    'operation timed out',
    'connection reset by peer',
    'connection refused',
    'temporary failure in name resolution',
    '502 Bad Gateway',
    '503 Service Unavailable',
    '504 Gateway Timeout',
  ] as const;
  for (const sample of TRANSIENT) {
    it('treats a network fault as transient: ' + sample, () => {
      expect(classifyRailwayFailure(sample)).toBe('transient');
    });
  }
  const FATAL = [
    'Unauthorized. Please login with railway login',
    'Invalid or expired token',
    'Service not found',
    'Project not found',
    'Build failed: npm ERR! missing script build',
  ] as const;
  for (const sample of FATAL) {
    it('never retries a real defect: ' + sample, () => {
      expect(classifyRailwayFailure(sample)).toBe('fatal');
    });
  }
  it('fails closed on unrecognised output', () => {
    expect(classifyRailwayFailure('something nobody has seen before')).toBe('fatal');
  });
  it('fails closed on empty output', () => {
    expect(classifyRailwayFailure('')).toBe('fatal');
  });
  it('matches case-insensitively, since CLI casing is not a contract', () => {
    expect(classifyRailwayFailure('OPERATION TIMED OUT')).toBe('transient');
  });
  it('prefers fatal when a build failure also mentions a timeout', () => {
    const mixed = 'Build failed' + String.fromCharCode(10) + 'operation timed out';
    expect(classifyRailwayFailure(mixed)).toBe('fatal');
  });
});

describe('shouldRetry', () => {
  it('retries a transient fault while attempts remain', () => {
    expect(shouldRetry('transient', 1)).toBe(true);
  });
  it('stops once the attempt budget is spent', () => {
    expect(shouldRetry('transient', MAX_ATTEMPTS)).toBe(false);
  });
  it('never retries a fatal fault, even on the first attempt', () => {
    expect(shouldRetry('fatal', 1)).toBe(false);
  });
  it('keeps the budget small enough to stay inside the deploy window', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(4);
  });
});

describe('backoffMs', () => {
  it('grows with each attempt', () => {
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1));
  });
  it('waits long enough for a backend blip to clear', () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(10_000);
  });
  it('stays bounded so a stuck backend cannot stall the run', () => {
    for (let a = 1; a <= MAX_ATTEMPTS; a += 1) {
      expect(backoffMs(a)).toBeLessThanOrEqual(60_000);
    }
  });
});
